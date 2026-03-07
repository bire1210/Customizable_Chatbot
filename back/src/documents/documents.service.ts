import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import crypto from 'crypto';
import { extractTextFromHtml } from './text-extractors/htmls';
import { extractTextFromMarkdown } from './text-extractors/markdown';
import { extractTextFromPdf } from './text-extractors/pdf';
import { VectorService } from 'src/vector/vector.service';

type ChunkDraft = {
  chunkIndex: number;
  content: string;
};

@Injectable()
export class DocumentsService {
    constructor(private readonly prisma: PrismaService, 
      private readonly vectorService: VectorService
    ) {}

  async createAndIngestDocument(params: {
    file: Express.Multer.File;
    title?: string;
  }) {
    const { file, title } = params;

    if (!file) {
      throw new BadRequestException('File is required');
    }

    const rawText = await this.extractTextFromFile(file);

    if (!rawText.trim()) {
      throw new BadRequestException('No text could be extracted from the file');
    }

    const document = await this.prisma.document.create({
      data: {
        title: title?.trim() || file.originalname,
        filename: file.filename,
      },
    });

    await this.ingestDocument({
      documentId: document.id,
      rawText,
    });

    return document;
  }
    
    /**
   * Step 2: Full ingestion pipeline
   */
  async ingestDocument(params: {
    documentId: string;
    rawText: string;
  }) {
    const { documentId, rawText } = params;

    const chunks = this.chunkText(rawText);

    if (!chunks.length) {
      throw new Error('No chunks generated from document');
    }

    const chunkTexts = chunks.map((chunk) => chunk.content);
    const embeddings = await this.vectorService.createBatchEmbeddings(chunkTexts);

    if (chunks.length !== embeddings?.length) {
      throw new Error('Chunks and embeddings count mismatch');
    }

    const valuePlaceholders = chunks
      .map(
        (chunk, i) =>
          `('${crypto.randomUUID()}', '${documentId}'::uuid, ${chunk.chunkIndex}, $${i + 1}, '${formatVector(embeddings[i])}'::vector)`,
      )
      .join(',');

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding) VALUES ${valuePlaceholders}`,
      ...chunkTexts,
    );
  }

    async getDocuments() {
        return this.prisma.document.findMany();
    }

    async getDocumentById(id: string) {
        return this.prisma.document.findUnique({
            where: { id },
        });
    }

    async getDocumentChunks(id: string) {
      return (this.prisma as any).documentChunk.findMany({
        where: { documentId: id },
        orderBy: { chunkIndex: 'asc' },
      });
    }

    private async extractTextFromFile(file: Express.Multer.File) {
      const extension = extname(file.originalname).toLowerCase();
      const filepath = file.path ?? join(file.destination, file.filename);
      const buffer = await fs.readFile(filepath);

      if (extension === '.pdf') {
        return extractTextFromPdf(buffer);
      }

      const content = buffer.toString('utf-8');

      if (extension === '.html' || extension === '.htm') {
        return extractTextFromHtml(content);
      }

      if (extension === '.md' || extension === '.markdown') {
        return extractTextFromMarkdown(content);
      }

      if (extension === '.txt') {
        return cleanTextForChunking(content);
      }

      throw new BadRequestException(`Unsupported file type: ${extension || 'unknown'}`);
    }
    async deleteDocument(id: string) {
      await this.prisma.documentChunk.deleteMany({
        where: { documentId: id },
      });
    
      await this.prisma.document.delete({
        where: { id },
      });
    }

    async searchSimilarChunks(
      queryEmbedding: number[],
      limit = 5,
    ) {
      const vector = formatVector(queryEmbedding)

      const result = await this.prisma.$queryRawUnsafe<
        { id: string; content: string; documentId: string; chunkIndex: number; distance: number }[]
      >(
        `
        SELECT 
          id,
          content,
          "documentId",
          "chunkIndex",
          embedding <=> $1::vector AS distance
        FROM "DocumentChunk"
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        `,
        vector,
        limit,
      )

      return result.map((row) => ({
        ...row,
        similarity: normalizeSimilarity(row.distance),
      }));
    }

  chunkText(text: string, chunkSize = 1800, overlap = 240): ChunkDraft[] {
    const prepared = cleanTextForChunking(text);
    const paragraphs = prepared
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    const units = paragraphs.flatMap((paragraph) => this.splitParagraph(paragraph, chunkSize));
    const chunkContents = mergeUnitsWithOverlap(units, chunkSize, overlap);

    return chunkContents
      .map((content, index) => ({ chunkIndex: index, content: content.trim() }))
      .filter((chunk) => chunk.content.length > 0);
  }

  private splitParagraph(paragraph: string, chunkSize: number): string[] {
    if (paragraph.length <= chunkSize) {
      return [paragraph];
    }

    const sentenceLike = paragraph
      .match(/[^.!?\n]+(?:[.!?]+|$)/g)
      ?.map((part) => part.trim())
      .filter(Boolean);

    if (!sentenceLike || sentenceLike.length <= 1) {
      return splitByLength(paragraph, chunkSize);
    }

    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentenceLike) {
      if (!current) {
        current = sentence;
        continue;
      }

      const candidate = `${current} ${sentence}`;
      if (candidate.length <= chunkSize) {
        current = candidate;
        continue;
      }

      chunks.push(current.trim());
      current = sentence;
    }

    if (current) {
      chunks.push(current.trim());
    }

    return chunks.flatMap((chunk) => (chunk.length <= chunkSize ? [chunk] : splitByLength(chunk, chunkSize)));
  }
}

function cleanTextForChunking(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitByLength(text: string, maxLen: number) {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length);
    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  return chunks.filter(Boolean);
}

function mergeUnitsWithOverlap(units: string[], chunkSize: number, overlap: number) {
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }

    const candidate = `${current}\n\n${unit}`;
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    chunks.push(current.trim());

    const tail = current.slice(Math.max(0, current.length - overlap)).trim();
    current = tail ? `${tail}\n\n${unit}` : unit;

    if (current.length > chunkSize) {
      chunks.push(current.slice(0, chunkSize).trim());
      current = current.slice(chunkSize).trim();
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function normalizeSimilarity(distance: number) {
  return Math.max(0, Math.min(1, 1 - distance));
}

function formatVector(embedding: number[]) {
  return `[${embedding.join(',')}]`;
}