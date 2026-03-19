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
    perDocumentCap?: number;
    diversityLambda?: number;
    candidateMultiplier?: number;
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
        const perDocumentCap = options.perDocumentCap ?? 2;
        const diversityLambda = options.diversityLambda ?? 0.65;
        const candidateMultiplier = options.candidateMultiplier ?? 4;
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

        const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
        const shortlisted = ranked.slice(0, Math.max(topK, topK * candidateMultiplier));

        return this.selectDiverseTopChunks(shortlisted, topK, perDocumentCap, diversityLambda);
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

    private selectDiverseTopChunks(
        candidates: RetrievedChunk[],
        topK: number,
        perDocumentCap: number,
        diversityLambda: number,
    ) {
        const selected: RetrievedChunk[] = [];
        const remaining = [...candidates];
        const docCounts = new Map<string, number>();

        while (selected.length < topK && remaining.length > 0) {
            let bestIndex = -1;
            let bestScore = Number.NEGATIVE_INFINITY;

            for (let i = 0; i < remaining.length; i++) {
                const candidate = remaining[i];
                const usedFromDoc = docCounts.get(candidate.documentId) ?? 0;
                if (usedFromDoc >= perDocumentCap) {
                    continue;
                }

                const redundancyPenalty = selected.length
                    ? Math.max(...selected.map((item) => this.textOverlap(candidate.content, item.content)))
                    : 0;

                const mmrScore = diversityLambda * candidate.score - (1 - diversityLambda) * redundancyPenalty;

                if (mmrScore > bestScore) {
                    bestScore = mmrScore;
                    bestIndex = i;
                }
            }

            if (bestIndex < 0) {
                break;
            }

            const [chosen] = remaining.splice(bestIndex, 1);
            selected.push(chosen);
            docCounts.set(chosen.documentId, (docCounts.get(chosen.documentId) ?? 0) + 1);
        }

        if (selected.length >= topK) {
            return selected;
        }

        for (const candidate of remaining) {
            if (selected.length >= topK) {
                break;
            }
            selected.push(candidate);
        }

        return selected;
    }

    private textOverlap(a: string, b: string) {
        const aTerms = this.normalizeTerms(a);
        const bTerms = this.normalizeTerms(b);

        if (!aTerms.size || !bTerms.size) {
            return 0;
        }

        let intersection = 0;
        for (const term of aTerms) {
            if (bTerms.has(term)) {
                intersection += 1;
            }
        }

        const union = aTerms.size + bTerms.size - intersection;
        if (!union) {
            return 0;
        }

        return intersection / union;
    }

    private normalizeTerms(input: string) {
        return new Set(
            input
                .toLowerCase()
                .split(/[^a-z0-9_]+/)
                .filter((token) => token.length >= 3)
                .slice(0, 120),
        );
    }
}

function normalizeSimilarity(distance: number) {
    return Math.max(0, Math.min(1, 1 - distance));
}

function formatVector(embedding: number[]) {
    return `[${embedding.join(',')}]`;
}
