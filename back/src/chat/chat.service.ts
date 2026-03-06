import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { VectorService } from 'src/vector/vector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatResponseDto } from './Dtos/chat-response.dto';
import crypto from 'crypto';
import { Readable } from 'stream';

@Injectable()
export class ChatService {
    private readonly generate_url = 'http://localhost:11434/api/generate';
    private readonly model_name = 'phi4-mini';

    constructor(
        private vector: VectorService,
        private prisma: PrismaService,
    ) {}

    async getOrCreateSession(sessionToken?: string) {
        if (sessionToken) {
            const existing = await (this.prisma as any).chatSession.findUnique({
                where: { sessionToken },
            });
            if (existing) return existing;
        }

        const token = sessionToken ?? crypto.randomUUID();
        const session = await (this.prisma as any).chatSession.create({
            data: { sessionToken: token, title: 'Chat' },
        });
        return session;
    }

    async storeMessage(sessionId: string, role: 'USER' | 'ASSISTANT' | 'SYSTEM', content: string) {
        return (this.prisma as any).chatMessage.create({
            data: {
                sessionId,
                role,
                content,
            },
        });
    }

    private async buildPromptAndContext(sessionToken: string | undefined, userMessage: string) {
        const session = await this.getOrCreateSession(sessionToken);

        await this.storeMessage(session.id, 'USER', userMessage);

        const embedding = await this.vector.createSingleTextVector(userMessage);
        const topChunks = await this.vector.searchSimilarVectors(embedding, 5);

        const contextText = topChunks.map((c) => c.content).join('\n\n');

        const history = await (this.prisma as any).chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
        });

        const conversation = history
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');

        const prompt = `You are an assistant. Answer using only the provided context when possible.\n\nConversation:\n${conversation}\n\nContext:\n${contextText}\n\nUser: ${userMessage}\nAssistant:`;

        return { session, topChunks, prompt };
    }

    private async persistAssistantAndBuildResponse(sessionId: string, replyText: string, topChunks: any[]): Promise<ChatResponseDto> {
        const assistantMsg = await this.storeMessage(sessionId, 'ASSISTANT', String(replyText));

        for (const chunk of topChunks) {
            await (this.prisma as any).chatCitation.create({
                data: {
                    messageId: assistantMsg.id,
                    documentChunkId: chunk.id,
                    score: chunk.distance ?? 0,
                    documentId: chunk.documentId,
                },
            });
        }

        return {
            reply: String(replyText),
            citations: topChunks.map((c) => ({ documentId: c.documentId, chunkId: c.id, score: c.distance })),
        };
    }

    private async streamGenerate(prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
        let replyText = '';

        try {
            const resp = await axios.post(this.generate_url, {
                model: this.model_name,
                prompt,
                stream: true,
            }, {
                responseType: 'stream',
            });

            const stream = resp.data as Readable;
            let buffer = '';

            await new Promise<void>((resolve, reject) => {
                stream.on('data', (chunk: Buffer | string) => {
                    buffer += chunk.toString();

                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        try {
                            const parsed = JSON.parse(trimmed);
                            const token = parsed?.response ?? '';

                            if (token) {
                                replyText += token;
                                if (onChunk) onChunk(token);
                            }
                        } catch {
                            // Ignore malformed partial JSON chunks.
                        }
                    }
                });

                stream.on('end', () => {
                    const trimmed = buffer.trim();

                    if (trimmed) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            const token = parsed?.response ?? '';

                            if (token) {
                                replyText += token;
                                if (onChunk) onChunk(token);
                            }
                        } catch {
                            // Ignore trailing malformed JSON.
                        }
                    }

                    resolve();
                });

                stream.on('error', (err: Error) => reject(err));
            });

            return replyText;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new InternalServerErrorException(`LLM generation failed: ${message}`);
        }
    }

    async handleUserMessageStream(
        sessionToken: string | undefined,
        userMessage: string,
        onChunk?: (chunk: string) => void,
    ): Promise<{ sessionToken: string; response: ChatResponseDto }> {
        const { session, topChunks, prompt } = await this.buildPromptAndContext(sessionToken, userMessage);
        const replyText = await this.streamGenerate(prompt, onChunk);
        const response = await this.persistAssistantAndBuildResponse(session.id, replyText, topChunks);

        return {
            sessionToken: session.sessionToken,
            response,
        };
    }

    async handleUserMessage(sessionToken: string | undefined, userMessage: string): Promise<ChatResponseDto> {
        const streamResult = await this.handleUserMessageStream(sessionToken, userMessage);
        return streamResult.response;
    }
}
