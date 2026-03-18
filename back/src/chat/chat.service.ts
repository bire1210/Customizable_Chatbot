import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { VectorService } from 'src/vector/vector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatResponseDto } from './Dtos/chat-response.dto';
import crypto from 'crypto';
import { Readable } from 'stream';
import { QueryRewriterService } from './query-rewriter.service';

@Injectable()
export class ChatService {
    private readonly generate_url = 'http://localhost:11434/api/generate';
    private readonly model_name = 'phi4-mini';
    private readonly topK = 5;
    private readonly historyWindow = 10;
    private readonly maxContextChars = 9000;
    private readonly minSimilarity = 0.52;
    private readonly maxReplyChars = 6400;
    private readonly maxPredictTokens = 1400;
    private readonly enableMultiQueryFusion = process.env.ENABLE_MULTI_QUERY_FUSION !== 'false';
    private readonly retrievalCandidatePool = 20;

    constructor(
        private vector: VectorService,
        private prisma: PrismaService,
        private queryRewriter: QueryRewriterService,
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

        const topChunks = await this.retrieveWithContextFusion(userMessage);
        const reliableChunks = topChunks.filter((chunk) => chunk.similarity >= this.minSimilarity);
        const chunksForContext = reliableChunks.length ? reliableChunks : topChunks.slice(0, 2);
        const expandedContexts = await this.expandContexts(chunksForContext, 1);
        const hasReliableContext = reliableChunks.length > 0;

        const contextText = expandedContexts.length
            ? this.limitContext(
            expandedContexts
                  .map((item) => {
                      const similarity = item.similarity.toFixed(3);
                      return `[document=${item.documentId} chunk=${item.chunkIndex} similarity=${similarity}]\n${item.content}`;
                  })
                  .join('\n\n---\n\n'),
              )
            : 'No usable context retrieved.';

        const contextHeader = hasReliableContext
            ? ''
            : 'Context quality is low. Use only what is explicitly supported by the retrieved excerpts.\n\n';

        const history = await (this.prisma as any).chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            take: this.historyWindow,
        });

        const conversation = history
            .reverse()
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');

        const prompt = `You are an assistant for document-grounded Q&A.
    Rules:
    1) Prioritize the provided context first.
    2) If context is partial, provide concise general guidance and clearly state what is uncertain.
    3) Keep output brief: max 6 bullet points or 1 short paragraph.
    4) Never repeat phrases.

    Conversation:
    ${conversation}

    Context:
    ${contextHeader}${contextText}

    User: ${userMessage}
    Assistant:`;

        return { session, topChunks, prompt, hasReliableContext };
    }

    private async retrieveWithContextFusion(userMessage: string) {
        if (!this.enableMultiQueryFusion) {
            const retrievalQuery = await this.queryRewriter.rewriteForRetrieval(userMessage);
            const embedding = await this.vector.createSingleTextVector(retrievalQuery);
            return this.vector.searchHybridChunks(retrievalQuery, embedding, this.topK, this.retrievalCandidatePool);
        }

        const variants = await this.queryRewriter.buildQueryVariants(userMessage);
        const fallbackQuery = variants[0] ?? userMessage;

        try {
            const embeddings = await this.vector.createBatchEmbeddings(variants);
            const settled = await Promise.allSettled(
                variants.map((query, index) =>
                    this.vector.searchHybridChunks(query, embeddings[index], this.topK, this.retrievalCandidatePool),
                ),
            );

            const successfulResults = settled
                .filter((result): result is PromiseFulfilledResult<any[]> => result.status === 'fulfilled')
                .map((result) => result.value);

            if (!successfulResults.length) {
                const fallbackEmbedding = await this.vector.createSingleTextVector(fallbackQuery);
                return this.vector.searchHybridChunks(fallbackQuery, fallbackEmbedding, this.topK, this.retrievalCandidatePool);
            }

            return this.vector.fuseMultiQueryResults(successfulResults, { topK: this.topK });
        } catch {
            const fallbackEmbedding = await this.vector.createSingleTextVector(fallbackQuery);
            return this.vector.searchHybridChunks(fallbackQuery, fallbackEmbedding, this.topK, this.retrievalCandidatePool);
        }
    }

    private async persistAssistantAndBuildResponse(sessionId: string, replyText: string, topChunks: any[]): Promise<ChatResponseDto> {
        const assistantMsg = await this.storeMessage(sessionId, 'ASSISTANT', String(replyText));

        for (const chunk of topChunks) {
            await (this.prisma as any).chatCitation.create({
                data: {
                    messageId: assistantMsg.id,
                    documentChunkId: chunk.id,
                    score: chunk.similarity ?? 0,
                    documentId: chunk.documentId,
                },
            });
        }

        return {
            reply: String(replyText),
            citations: topChunks.map((c) => ({
                documentId: c.documentId,
                chunkId: c.id,
                score: c.similarity,
                distance: c.distance,
                chunkIndex: c.chunkIndex,
            })),
        };
    }

    private async expandContexts(topChunks: any[], window = 1) {
        if (!topChunks.length) {
            return [];
        }

        const grouped = new Map<string, { start: number; end: number; similarity: number; chunkIndex: number }[]>();

        for (const chunk of topChunks) {
            const ranges = grouped.get(chunk.documentId) ?? [];
            ranges.push({
                start: Math.max(0, chunk.chunkIndex - window),
                end: chunk.chunkIndex + window,
                similarity: chunk.similarity,
                chunkIndex: chunk.chunkIndex,
            });
            grouped.set(chunk.documentId, ranges);
        }

        const contextBlocks: any[] = [];

        for (const [documentId, ranges] of grouped.entries()) {
            const mergedRanges = this.mergeRanges(ranges);

            for (const range of mergedRanges) {
                const neighbors = await this.prisma.$queryRawUnsafe<any[]>(
                    `
                    SELECT id, content, "documentId", "chunkIndex"
                    FROM "DocumentChunk"
                    WHERE "documentId" = $1
                      AND "chunkIndex" BETWEEN $2 AND $3
                    ORDER BY "chunkIndex" ASC
                    `,
                    documentId,
                    range.start,
                    range.end,
                );

                if (!neighbors.length) {
                    continue;
                }

                contextBlocks.push({
                    id: neighbors[0].id,
                    documentId,
                    chunkIndex: range.chunkIndex,
                    distance: 1 - range.similarity,
                    similarity: range.similarity,
                    content: neighbors.map((row) => row.content).join('\n\n'),
                });
            }
        }

        const deduped = new Map<string, any>();
        for (const block of contextBlocks) {
            const key = `${block.documentId}:${block.content}`;
            const existing = deduped.get(key);
            if (!existing || existing.similarity < block.similarity) {
                deduped.set(key, block);
            }
        }

        return [...deduped.values()].sort((a, b) => b.similarity - a.similarity).slice(0, this.topK);
    }

    private mergeRanges(
        ranges: Array<{ start: number; end: number; similarity: number; chunkIndex: number }>,
    ) {
        const sorted = [...ranges].sort((a, b) => a.start - b.start);
        if (!sorted.length) {
            return [];
        }

        const merged: Array<{ start: number; end: number; similarity: number; chunkIndex: number }> = [
            { ...sorted[0] },
        ];

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];
            const last = merged[merged.length - 1];

            if (current.start <= last.end + 1) {
                last.end = Math.max(last.end, current.end);
                if (current.similarity > last.similarity) {
                    last.similarity = current.similarity;
                    last.chunkIndex = current.chunkIndex;
                }
                continue;
            }

            merged.push({ ...current });
        }

        return merged;
    }

    private limitContext(contextText: string) {
        if (contextText.length <= this.maxContextChars) {
            return contextText;
        }

        return contextText.slice(0, this.maxContextChars);
    }

    private async streamGenerate(prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
        let replyText = '';

        try {
            const resp = await axios.post(this.generate_url, {
                model: this.model_name,
                prompt,
                stream: true,
                options: {
                    num_predict: this.maxPredictTokens,
                    temperature: 0.2,
                    repeat_penalty: 1.2,
                    top_p: 0.9,
                    stop: ['\nUser:', '\nUSER:', '\nSystem:'],
                },
            }, {
                responseType: 'stream',
            });

            const stream = resp.data as Readable;
            let buffer = '';
            let settled = false;

            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };

                stream.on('data', (chunk: Buffer | string) => {
                    if (settled) return;
                    buffer += chunk.toString();

                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        try {
                            const parsed = JSON.parse(trimmed);
                            const token = parsed?.response ?? '';

                            if (parsed?.done) {
                                finish();
                                return;
                            }

                            if (token) {
                                const remaining = this.maxReplyChars - replyText.length;
                                if (remaining <= 0) {
                                    finish();
                                    stream.destroy();
                                    return;
                                }

                                const safeToken = token.slice(0, remaining);
                                replyText += safeToken;
                                if (onChunk) onChunk(safeToken);

                                if (replyText.length >= this.maxReplyChars) {
                                    finish();
                                    stream.destroy();
                                    return;
                                }
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
                                const remaining = this.maxReplyChars - replyText.length;
                                if (remaining > 0) {
                                    const safeToken = token.slice(0, remaining);
                                    replyText += safeToken;
                                    if (onChunk) onChunk(safeToken);
                                }
                            }
                        } catch {
                            // Ignore trailing malformed JSON.
                        }
                    }

                    finish();
                });

                stream.on('error', (err: Error) => {
                    if (settled) return;
                    reject(err);
                });
            });

            const sanitized = replyText.trim();
            if (!sanitized) {
                return "I don't have enough grounded context to answer that yet.";
            }

            return sanitized;
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
