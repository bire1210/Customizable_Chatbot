import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class QueryRewriterService {
  private readonly logger = new Logger(QueryRewriterService.name);
  private readonly llmUrl = process.env.QUERY_REWRITER_LLM_URL ?? 'http://localhost:11434/api/generate';
  private readonly llmModel = process.env.QUERY_REWRITER_LLM_MODEL ?? 'phi4-mini';
  private readonly enableLlmFallback = process.env.QUERY_REWRITER_ENABLE_LLM_FALLBACK === 'true';

  async rewriteForRetrieval(rawQuery: string): Promise<string> {
    const normalized = this.normalizeWhitespace(rawQuery);
    const deterministic = this.applyDeterministicRewrite(normalized);

    if (!this.shouldUseLlmFallback(normalized, deterministic)) {
      return deterministic;
    }

    try {
      const llmRewrite = await this.rewriteWithLlm(normalized);
      return llmRewrite || deterministic;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown rewrite error';
      this.logger.warn(`LLM fallback rewrite failed. Using deterministic rewrite. Reason: ${message}`);
      return deterministic;
    }
  }

  private normalizeWhitespace(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
  }

  private applyDeterministicRewrite(input: string): string {
    let rewritten = input;

    // Strip common conversational wrappers that add noise but little retrieval value.
    rewritten = rewritten.replace(
      /^(hi|hello|hey|please|kindly|can you|could you|would you|i need help with|i want to know|tell me about)\b[:,\-\s]*/i,
      '',
    );

    rewritten = rewritten.replace(/\b(thanks|thank you|please)\b[.!?\s]*$/i, '').trim();
    rewritten = rewritten.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();

    if (!rewritten) {
      return input;
    }

    return rewritten;
  }

  private shouldUseLlmFallback(original: string, deterministic: string): boolean {
    if (!this.enableLlmFallback) {
      return false;
    }

    if (!deterministic || deterministic.length < 8) {
      return true;
    }

    if (!/[?]/.test(original) && original.length > 220) {
      return true;
    }

    return false;
  }

  private async rewriteWithLlm(query: string): Promise<string> {
    const prompt = [
      'Rewrite the user query for retrieval in a RAG system.',
      'Rules:',
      '1) Keep intent unchanged.',
      '2) Remove irrelevant conversational filler.',
      '3) Preserve domain nouns and key constraints.',
      '4) Return exactly one rewritten query and nothing else.',
      `User query: ${query}`,
      'Rewritten query:',
    ].join('\n');

    const response = await axios.post(this.llmUrl, {
      model: this.llmModel,
      prompt,
      stream: false,
      options: {
        temperature: 0,
        num_predict: 120,
      },
    });

    const rewritten = String(response?.data?.response ?? '').replace(/\s+/g, ' ').trim();
    return rewritten;
  }
}
