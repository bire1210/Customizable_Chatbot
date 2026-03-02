import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class VectorService {
    private readonly model_name = 'nomic-embed-text';
    private readonly targetDimension = 1536;

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

            return this.normalizeEmbeddingDimensions(vector);
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

            return embeddings.map((embedding) => this.normalizeEmbeddingDimensions(embedding));
        }
        catch(error: unknown){
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new InternalServerErrorException(`Failed to create batch embeddings: ${message}`);
        }
    }

    private normalizeEmbeddingDimensions(embedding: number[]) {
        if (embedding.length === this.targetDimension) {
            return embedding;
        }

        if (embedding.length > this.targetDimension) {
            return embedding.slice(0, this.targetDimension);
        }

        const padded = [...embedding];
        while (padded.length < this.targetDimension) {
            padded.push(0);
        }
        return padded;
    }

    async searchSimilarVectors(embedding: number[], topK = 5) {
        const vector = formatVector(embedding);

        const result = await this.prisma.$queryRawUnsafe<
            { id: string; content: string; documentId: string; distance: number }[]
        >(
            `
            SELECT
              id,
              content,
              "documentId",
              embedding <=> $1::vector AS distance
            FROM "DocumentChunk"
            ORDER BY embedding <=> $1::vector
            LIMIT $2
            `,
            vector,
            topK,
        );

        return result;
    }
}

function formatVector(embedding: number[]) {
    return `[${embedding.join(',')}]`;
}
