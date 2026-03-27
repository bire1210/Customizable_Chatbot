import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { VectorService } from 'src/vector/vector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatResponseDto } from './Dtos/chat-response.dto';
import crypto from 'crypto';
import { Readable } from 'stream';
import { QueryRewriterService } from './query-rewriter.service';
import { EvaluationLoggerService, RetrievalTelemetry } from 'src/evaluation/evaluation-logger.service';

type RequestMeta = {
    channel?: 'ws' | 'http' | 'unknown';
    clientId?: string;
};

type OutputConstraint = {
    requestedCount?: number;
    listRequired: boolean;
    topicKeywords: string[];
};

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
    private readonly retrievalCandidatePool = Number(process.env.RETRIEVAL_CANDIDATE_POOL ?? 40);
    private readonly countHintTerms = ['example', 'examples', 'types', 'ways', 'steps', 'patterns', 'reasons'];

    constructor(
        private vector: VectorService,
        private prisma: PrismaService,
        private queryRewriter: QueryRewriterService,
        private evaluationLogger: EvaluationLoggerService,
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

        const retrieval = await this.retrieveWithContextFusion(userMessage);
        const topChunks = retrieval.topChunks;
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

        const responseStyleGuide = this.buildResponseStyleGuide(userMessage);
        const constraint = this.extractOutputConstraint(userMessage);
        const constraintInstruction = this.buildConstraintInstruction(constraint);

        const prompt = `You are an assistant for document-grounded Q&A.
    Rules:
    1) Prioritize the provided context first.
    2) If context is partial, provide concise general guidance and clearly state what is uncertain.
    3) ${responseStyleGuide}
    4) Never repeat phrases.
    5) ${constraintInstruction}

    Conversation:
    ${conversation}

    Context:
    ${contextHeader}${contextText}

    User: ${userMessage}
    Assistant:`;

        return {
            session,
            topChunks,
            prompt,
            hasReliableContext,
            contextChars: contextText.length,
            retrievalTelemetry: retrieval.telemetry,
            constraint,
        };
    }

    private async retrieveWithContextFusion(userMessage: string): Promise<{ topChunks: any[]; telemetry: RetrievalTelemetry }> {
        const retrievalStart = Date.now();

        if (!this.enableMultiQueryFusion) {
            const variantStart = Date.now();
            const retrievalQuery = await this.queryRewriter.rewriteForRetrieval(userMessage);
            const variantGenerationMs = Date.now() - variantStart;

            const embeddingStart = Date.now();
            const embedding = await this.vector.createSingleTextVector(retrievalQuery);
            const embeddingMs = Date.now() - embeddingStart;

            const searchStart = Date.now();
            const topChunks = await this.vector.searchHybridChunks(
                retrievalQuery,
                embedding,
                this.topK,
                this.retrievalCandidatePool,
            );
            const searchMs = Date.now() - searchStart;

            return {
                topChunks,
                telemetry: {
                    mode: 'single',
                    variantCount: 1,
                    successfulVariantCount: 1,
                    fallbackUsed: false,
                    variantGenerationMs,
                    embeddingMs,
                    searchMs,
                    fusionMs: 0,
                    retrievalMs: Date.now() - retrievalStart,
                    topChunkIds: topChunks.map((chunk) => chunk.id),
                    topChunkSimilarities: topChunks.map((chunk) => Number((chunk.similarity ?? 0).toFixed(4))),
                },
            };
        }

        const variantStart = Date.now();
        const variants = await this.queryRewriter.buildQueryVariants(userMessage);
        const variantGenerationMs = Date.now() - variantStart;
        const fallbackQuery = variants[0] ?? userMessage;

        try {
            const embeddingStart = Date.now();
            const embeddings = await this.vector.createBatchEmbeddings(variants);
            const embeddingMs = Date.now() - embeddingStart;

            const searchStart = Date.now();
            const settled = await Promise.allSettled(
                variants.map((query, index) =>
                    this.vector.searchHybridChunks(query, embeddings[index], this.topK, this.retrievalCandidatePool),
                ),
            );
            const searchMs = Date.now() - searchStart;

            const successfulResults = settled
                .filter((result): result is PromiseFulfilledResult<any[]> => result.status === 'fulfilled')
                .map((result) => result.value);

            if (!successfulResults.length) {
                const fallbackEmbedding = await this.vector.createSingleTextVector(fallbackQuery);
                const topChunks = await this.vector.searchHybridChunks(
                    fallbackQuery,
                    fallbackEmbedding,
                    this.topK,
                    this.retrievalCandidatePool,
                );

                return {
                    topChunks,
                    telemetry: {
                        mode: 'fusion',
                        variantCount: variants.length,
                        successfulVariantCount: 0,
                        fallbackUsed: true,
                        variantGenerationMs,
                        embeddingMs,
                        searchMs,
                        fusionMs: 0,
                        retrievalMs: Date.now() - retrievalStart,
                        topChunkIds: topChunks.map((chunk) => chunk.id),
                        topChunkSimilarities: topChunks.map((chunk) => Number((chunk.similarity ?? 0).toFixed(4))),
                    },
                };
            }

            const fusionStart = Date.now();
            const topChunks = this.vector.fuseMultiQueryResults(successfulResults, {
                topK: this.topK,
                perDocumentCap: 2,
                diversityLambda: 0.65,
                candidateMultiplier: 4,
            });
            const fusionMs = Date.now() - fusionStart;

            return {
                topChunks,
                telemetry: {
                    mode: 'fusion',
                    variantCount: variants.length,
                    successfulVariantCount: successfulResults.length,
                    fallbackUsed: false,
                    variantGenerationMs,
                    embeddingMs,
                    searchMs,
                    fusionMs,
                    retrievalMs: Date.now() - retrievalStart,
                    topChunkIds: topChunks.map((chunk) => chunk.id),
                    topChunkSimilarities: topChunks.map((chunk) => Number((chunk.similarity ?? 0).toFixed(4))),
                },
            };
        } catch {
            const fallbackEmbeddingStart = Date.now();
            const fallbackEmbedding = await this.vector.createSingleTextVector(fallbackQuery);
            const embeddingMs = Date.now() - fallbackEmbeddingStart;

            const fallbackSearchStart = Date.now();
            const topChunks = await this.vector.searchHybridChunks(
                fallbackQuery,
                fallbackEmbedding,
                this.topK,
                this.retrievalCandidatePool,
            );
            const searchMs = Date.now() - fallbackSearchStart;

            return {
                topChunks,
                telemetry: {
                    mode: 'fusion',
                    variantCount: variants.length,
                    successfulVariantCount: 0,
                    fallbackUsed: true,
                    variantGenerationMs,
                    embeddingMs,
                    searchMs,
                    fusionMs: 0,
                    retrievalMs: Date.now() - retrievalStart,
                    topChunkIds: topChunks.map((chunk) => chunk.id),
                    topChunkSimilarities: topChunks.map((chunk) => Number((chunk.similarity ?? 0).toFixed(4))),
                },
            };
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

    private buildResponseStyleGuide(userMessage: string) {
        const normalized = userMessage.toLowerCase();
        const asksForDetail =
            /(how|why|step|steps|implement|architecture|design|example|explain|guide|walkthrough)/.test(normalized);

        if (asksForDetail) {
            return 'For how/why/implementation requests, answer in structured detail with step-by-step bullets and practical examples.';
        }

        return 'Keep output brief: max 6 bullet points or 1 short paragraph unless the user explicitly requests detail.';
    }

    private extractOutputConstraint(userMessage: string): OutputConstraint {
        const normalized = userMessage.toLowerCase();
        const requestedCount = this.extractRequestedCount(normalized);
        const asksForList = /(list|examples|example|types|ways|steps|patterns|give me)/.test(normalized);
        const topicKeywords = this.extractTopicKeywords(normalized);

        return {
            requestedCount,
            listRequired: asksForList || typeof requestedCount === 'number',
            topicKeywords,
        };
    }

    private extractRequestedCount(normalizedMessage: string) {
        const countRegex = new RegExp(`(\\d+)\\s+(${this.countHintTerms.join('|')})`);
        const match = normalizedMessage.match(countRegex);
        if (!match) {
            return undefined;
        }

        const parsed = Number(match[1]);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 20) {
            return undefined;
        }

        return parsed;
    }

    private extractTopicKeywords(normalizedMessage: string) {
        const stopWords = new Set([
            'the', 'and', 'for', 'with', 'from', 'that', 'this', 'those', 'these', 'into', 'about', 'what',
            'when', 'where', 'which', 'would', 'could', 'should', 'have', 'has', 'had', 'them', 'they',
            'give', 'show', 'tell', 'please', 'need', 'want', 'make', 'like', 'just', 'more', 'how', 'why',
            'can', 'you', 'your', 'our', 'are', 'is', 'was', 'were', 'write', 'explain',
        ]);

        const tokens = normalizedMessage
            .split(/[^a-z0-9_]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 4 && !stopWords.has(token));

        return [...new Set(tokens)].slice(0, 5);
    }

    private buildConstraintInstruction(constraint: OutputConstraint) {
        const listLine = constraint.listRequired
            ? 'Return a clear numbered list where each item is distinct.'
            : 'No strict list format is required.';

        const countLine = typeof constraint.requestedCount === 'number'
            ? `Return exactly ${constraint.requestedCount} items.`
            : 'Do not invent an arbitrary item count.';

        const topicLine = constraint.topicKeywords.length
            ? `Keep every item on-topic for: ${constraint.topicKeywords.join(', ')}.`
            : 'Keep the answer aligned with the user request.';

        return `${listLine} ${countLine} ${topicLine}`;
    }

    private validateReplyAgainstConstraint(replyText: string, constraint: OutputConstraint) {
        if (!replyText.trim()) {
            return false;
        }

        if (constraint.topicKeywords.length) {
            const lower = replyText.toLowerCase();
            const hasAnyTopic = constraint.topicKeywords.some((keyword) => lower.includes(keyword));
            if (!hasAnyTopic) {
                return false;
            }
        }

        if (!constraint.listRequired && typeof constraint.requestedCount !== 'number') {
            return true;
        }

        const itemCount = this.countListItems(replyText);
        if (typeof constraint.requestedCount === 'number') {
            return itemCount === constraint.requestedCount;
        }

        return itemCount >= 2;
    }

    private countListItems(replyText: string) {
        const lines = replyText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        const listLineCount = lines.filter((line) => /^(\d+[.)]|[-*])\s+/.test(line)).length;
        if (listLineCount > 0) {
            return listLineCount;
        }

        const sentenceCount = replyText
            .split(/\n{2,}|(?<=[.!?])\s+/)
            .map((part) => part.trim())
            .filter((part) => part.length > 0).length;

        return sentenceCount;
    }

    private async generateWithConstraintGuard(
        prompt: string,
        constraint: OutputConstraint,
        onChunk?: (chunk: string) => void,
    ) {
        const firstAttempt = await this.streamGenerate(prompt);
        if (this.validateReplyAgainstConstraint(firstAttempt, constraint)) {
            if (onChunk) {
                onChunk(firstAttempt);
            }
            return { replyText: firstAttempt, retried: false, pass: true };
        }

        const correctivePrompt = `${prompt}\n\nYour previous answer did not follow the exact output constraints. Rewrite now and strictly satisfy all count/format/topic constraints.`;
        const secondAttempt = await this.streamGenerate(correctivePrompt);
        const pass = this.validateReplyAgainstConstraint(secondAttempt, constraint);

        if (onChunk) {
            onChunk(secondAttempt);
        }

        return { replyText: secondAttempt, retried: true, pass };
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
        meta: RequestMeta = {},
    ): Promise<{ sessionToken: string; response: ChatResponseDto }> {
        const requestId = crypto.randomUUID();
        const turnStart = Date.now();
        let streamedChunkCount = 0;

        try {
            const { session, topChunks, prompt, contextChars, retrievalTelemetry, constraint } = await this.buildPromptAndContext(
                sessionToken,
                userMessage,
            );

            const generationStart = Date.now();
            const requiresGuardedValidation = Boolean(constraint.listRequired || typeof constraint.requestedCount === 'number');

            let replyText = '';
            let retried = false;
            let constraintPass = true;

            if (requiresGuardedValidation) {
                const guarded = await this.generateWithConstraintGuard(prompt, constraint, (chunk: string) => {
                    streamedChunkCount += 1;
                    if (onChunk) {
                        onChunk(chunk);
                    }
                });
                replyText = guarded.replyText;
                retried = guarded.retried;
                constraintPass = guarded.pass;
            } else {
                replyText = await this.streamGenerate(prompt, (chunk: string) => {
                    streamedChunkCount += 1;
                    if (onChunk) {
                        onChunk(chunk);
                    }
                });
            }
            const generationMs = Date.now() - generationStart;

            const persistenceStart = Date.now();
            const response = await this.persistAssistantAndBuildResponse(session.id, replyText, topChunks);
            const persistenceMs = Date.now() - persistenceStart;

            await this.evaluationLogger.logTurn({
                timestamp: new Date().toISOString(),
                requestId,
                sessionToken: session.sessionToken,
                channel: meta.channel ?? 'unknown',
                clientId: meta.clientId,
                questionLength: userMessage.length,
                replyLength: replyText.length,
                streamedChunkCount,
                contextChars,
                citationCount: response.citations?.length ?? 0,
                turnLatencyMs: Date.now() - turnStart,
                generationMs,
                persistenceMs,
                retrieval: retrievalTelemetry,
                success: true,
                constraintRequested: requiresGuardedValidation,
                constraintPass,
                generationRetried: retried,
            });

            return {
                sessionToken: session.sessionToken,
                response,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown chat error';

            await this.evaluationLogger.logTurn({
                timestamp: new Date().toISOString(),
                requestId,
                sessionToken: sessionToken ?? 'unknown',
                channel: meta.channel ?? 'unknown',
                clientId: meta.clientId,
                questionLength: userMessage.length,
                replyLength: 0,
                streamedChunkCount,
                contextChars: 0,
                citationCount: 0,
                turnLatencyMs: Date.now() - turnStart,
                generationMs: 0,
                persistenceMs: 0,
                retrieval: {
                    mode: this.enableMultiQueryFusion ? 'fusion' : 'single',
                    variantCount: 0,
                    successfulVariantCount: 0,
                    fallbackUsed: true,
                    variantGenerationMs: 0,
                    embeddingMs: 0,
                    searchMs: 0,
                    fusionMs: 0,
                    retrievalMs: 0,
                    topChunkIds: [],
                    topChunkSimilarities: [],
                },
                success: false,
                errorMessage: message,
                constraintRequested: false,
                constraintPass: false,
                generationRetried: false,
            });

            throw error;
        }
    }

    async handleUserMessage(sessionToken: string | undefined, userMessage: string): Promise<ChatResponseDto> {
        const streamResult = await this.handleUserMessageStream(sessionToken, userMessage, undefined, { channel: 'http' });
        return streamResult.response;
    }
}
