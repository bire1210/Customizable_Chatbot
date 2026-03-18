import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from 'src/prisma/prisma.service';

type RetrievedChunk = {
    id: string;
    content: string;
    documentId: string;
    chunkIndex: number;
    distance: number;
    similarity: number;
    score: number;
};

type FusionOptions = {
    topK?: number;
    variantWeights?: number[];
};

@Injectable()
export class VectorService {
    private readonly model_name = 'nomic-embed-text';
    private readonly targetDimension = 768;
    private readonly rrfK = 60;

    constructor(private prisma: PrismaService) {}
    

    async createSingleTextVector(text: string) {
        try{
            const response = await axios.post('http://localhost:11434/api/embeddings', {
                model: this.model_name,
                prompt: text,
            });

            const vector = response.data?.embedding as number[] | undefined;

            if (!Array.isArray(vector) || !vector.length) {
                throw new InternalServerErrorException('Ollama returned empty embedding for single text');
            }

            return this.ensureEmbeddingDimensions(vector);
        }
        catch(error: unknown){
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new InternalServerErrorException(`Failed to create embedding: ${message}`);
        }
    }

    async createBatchEmbeddings(texts: string[]) {
        try{
            const response = await axios.post('http://localhost:11434/api/embed', {
                model: this.model_name,
                input: texts,
            });

            const embeddings = response.data?.embeddings as number[][] | undefined;
            if (!Array.isArray(embeddings) || !embeddings.length) {
                throw new InternalServerErrorException('Ollama returned empty embeddings array');
            }

            return embeddings.map((embedding) => this.ensureEmbeddingDimensions(embedding));
        }
        catch(error: unknown){
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new InternalServerErrorException(`Failed to create batch embeddings: ${message}`);
        }
    }

    private ensureEmbeddingDimensions(embedding: number[]) {
        if (embedding.length !== this.targetDimension) {
            throw new InternalServerErrorException(
                `Embedding dimension mismatch. Expected ${this.targetDimension}, got ${embedding.length}`,
            );
        }

        return embedding;
    }

    async searchSimilarVectors(embedding: number[], topK = 5) {
        const vector = formatVector(embedding);

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
            topK,
        );

        return result.map((row, index) => ({
            ...row,
            similarity: normalizeSimilarity(row.distance),
            score: 1 / (this.rrfK + index + 1),
        }));
    }

    async searchKeywordChunks(query: string, limit = 20) {
        const result = await this.prisma.$queryRawUnsafe<
            { id: string; content: string; documentId: string; chunkIndex: number; rank: number }[]
        >(
            `
            SELECT
              id,
              content,
              "documentId",
              "chunkIndex",
              ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) AS rank
            FROM "DocumentChunk"
            WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
            ORDER BY rank DESC
            LIMIT $2
            `,
            query,
            limit,
        );

        return result.map((row, index) => ({
            id: row.id,
            content: row.content,
            documentId: row.documentId,
            chunkIndex: row.chunkIndex,
            distance: 1,
            similarity: 0,
            score: 1 / (this.rrfK + index + 1),
        }));
    }

    async searchHybridChunks(query: string, embedding: number[], topK = 6, candidatePool = 20): Promise<RetrievedChunk[]> {
        const [vectorResults, keywordResults] = await Promise.all([
            this.searchSimilarVectors(embedding, candidatePool),
            this.searchKeywordChunks(query, candidatePool),
        ]);

        const merged = new Map<string, RetrievedChunk>();

        for (const item of [...vectorResults, ...keywordResults]) {
            const existing = merged.get(item.id);
            if (!existing) {
                merged.set(item.id, { ...item });
                continue;
            }

            existing.score += item.score;
            if (item.distance < existing.distance) {
                existing.distance = item.distance;
                existing.similarity = item.similarity;
            }
        }

        return [...merged.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    fuseMultiQueryResults(resultSets: RetrievedChunk[][], options: FusionOptions = {}): RetrievedChunk[] {
        const topK = options.topK ?? 6;
        const variantWeights = options.variantWeights ?? [];
        const merged = new Map<string, RetrievedChunk>();

        for (let setIndex = 0; setIndex < resultSets.length; setIndex++) {
            const weight = variantWeights[setIndex] ?? this.defaultVariantWeight(setIndex);
            const set = resultSets[setIndex] ?? [];

            for (const item of set) {
                const existing = merged.get(item.id);
                const weightedScore = item.score * weight;

                if (!existing) {
                    merged.set(item.id, {
                        ...item,
                        score: weightedScore,
                    });
                    continue;
                }

                existing.score += weightedScore;
                if (item.distance < existing.distance) {
                    existing.distance = item.distance;
                    existing.similarity = item.similarity;
                }
            }
        }

        return [...merged.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    private defaultVariantWeight(index: number) {
        if (index === 0) {
            return 1;
        }

        if (index === 1) {
            return 0.85;
        }

        return 0.7;
    }
}

function normalizeSimilarity(distance: number) {
    return Math.max(0, Math.min(1, 1 - distance));
}

function formatVector(embedding: number[]) {
    return `[${embedding.join(',')}]`;
}
