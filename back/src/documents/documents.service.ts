import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { extractTextFromHtml } from './text-extractors/htmls';
import { extractTextFromMarkdown } from './text-extractors/markdown';
import { extractTextFromPdf } from './text-extractors/pdf';

@Injectable()
export class DocumentsService {
    constructor(private readonly prisma: PrismaService) {}

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

    const chunks = chunkText(rawText);

    if (!chunks.length) {
      throw new Error('No chunks generated from document');
    }

    const embeddings = await embedMany(chunks);

    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings count mismatch');
    }

    await this.prisma.$executeRawUnsafe(`
        INSERT INTO "DocumentChunk" (id, "documentId", content, embedding)
        VALUES ${chunks
            .map(
            (_, i) =>
                `('${crypto.randomUUID()}', '${documentId}', $${i * 2 + 1}, $${i * 2 + 2})`
            )
            .join(',')}
        `, ...chunks.flatMap((content, i) => [content, embeddings[i]]));
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
      return this.prisma.documentChunk.findMany({
        where: { documentId: id },
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
        return normalizeWhitespace(content);
      }

      throw new BadRequestException(`Unsupported file type: ${extension || 'unknown'}`);
    }
}

function chunkText(text: string, chunkSize = 500, overlap = 100) {
  const words = normalizeWhitespace(text).split(' ');
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
    i += chunkSize - overlap;
  }

  return chunks;
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

async function embedMany(chunks: string[]): Promise<number[][]> {
  // Placeholder embeddings to keep the pipeline working until a real model is wired up.
  const dimension = 1536;
  return chunks.map(() => Array.from({ length: dimension }, () => 0));
}