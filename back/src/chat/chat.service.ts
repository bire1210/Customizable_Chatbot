import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { VectorService } from 'src/vector/vector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ChatResponseDto } from './Dtos/chat-response.dto';
import crypto from 'crypto';

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

    async handleUserMessage(sessionToken: string | undefined, userMessage: string): Promise<ChatResponseDto> {
        const startTime = Date.now();
        const session = await this.getOrCreateSession(sessionToken);
        console.log(`Handling message for session took this much time: ${Date.now() - startTime}ms`);

        // persist user message
        const startTime2 = Date.now();
        await this.storeMessage(session.id, 'USER', userMessage);
        console.log(`Storing user message took this much time: ${Date.now() - startTime2}ms`);

        // embed and search
        const startTime3 = Date.now();
        const embedding = await this.vector.createSingleTextVector(userMessage);
        const topChunks = await this.vector.searchSimilarVectors(embedding, 5);
        console.log(`Embedding and vector search took this much time: ${Date.now() - startTime3}ms`);

        const contextText = topChunks.map((c) => c.content).join('\n\n');

        // assemble prompt using full session history
        const startTime4 = Date.now();
        const history = await (this.prisma as any).chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
        });
        console.log(`Fetching message history took this much time: ${Date.now() - startTime4}ms`);

        const conversation = history
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');

        const prompt = `You are an assistant. Answer using only the provided context when possible.\n\nConversation:\n${conversation}\n\nContext:\n${contextText}\n\nUser: ${userMessage}\nAssistant:`;

        let replyText = '';
        const startTime5 = Date.now();
        try {
            const resp = await axios.post(this.generate_url, {
                model: this.model_name,
                prompt,
                stream: false,
            });
            console.log(`LLM generation took this much time: ${Date.now() - startTime5}ms`);


            // Ollama responses vary; try common fields
            replyText = resp.data?.response ?? resp.data?.output ?? JSON.stringify(resp.data);

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            throw new InternalServerErrorException(`LLM generation failed: ${message}`);
        }

        // persist assistant message
        const staretTime6 = Date.now();
        const assistantMsg = await this.storeMessage(session.id, 'ASSISTANT', String(replyText));

        console.log(`Storing assistant message took this much time: ${Date.now() - staretTime6}ms`);
        // persist citations for top chunks

        const startTime7 = Date.now();
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
        console.log(`Storing citations took this much time: ${Date.now() - startTime7}ms`);

        const response: ChatResponseDto = {
            reply: String(replyText),
            citations: topChunks.map((c) => ({ documentId: c.documentId, chunkId: c.id, score: c.distance })),
            sessionToken: session.sessionToken,
        };

        return response;
    }

    async getMessages(sessionToken: string) {
        const session = await this.getOrCreateSession(sessionToken);
        const messages = await (this.prisma as any).chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
        });
        return { messages, sessionToken: session.sessionToken };
    }
}
