import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class QueryRewriterService {
  private readonly logger = new Logger(QueryRewriterService.name);
  private readonly llmUrl = process.env.QUERY_REWRITER_LLM_URL ?? 'http://localhost:11434/api/generate';
  private readonly llmModel = process.env.QUERY_REWRITER_LLM_MODEL ?? 'phi4-mini';
  private readonly enableLlmFallback = process.env.QUERY_REWRITER_ENABLE_LLM_FALLBACK === 'true';
  private readonly maxVariants = Number(process.env.QUERY_REWRITER_MAX_VARIANTS ?? 4);
  private readonly stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this', 'that', 'these', 'those',
    'can', 'could', 'would', 'should', 'please', 'kindly', 'tell', 'me', 'about', 'my', 'your',
    'how', 'what', 'why', 'when', 'where', 'who', 'which',
  ]);

  async rewriteForRetrieval(rawQuery: string): Promise<string> {
    const variants = await this.buildQueryVariants(rawQuery);
    return variants[0] ?? rawQuery;
  }

  async buildQueryVariants(rawQuery: string): Promise<string[]> {
    const normalized = this.normalizeWhitespace(rawQuery);
    const deterministic = this.applyDeterministicRewrite(normalized);

    const variants = new Set<string>();
    variants.add(deterministic);

    for (const item of this.buildDeterministicVariants(deterministic)) {
      variants.add(item);
      if (variants.size >= this.maxVariants) {
        return [...variants].slice(0, this.maxVariants);
      }
    }

    if (!this.shouldUseLlmFallback(normalized, deterministic) || variants.size >= this.maxVariants) {
      return [...variants].slice(0, this.maxVariants);
    }

    try {
      const needed = Math.max(0, this.maxVariants - variants.size);
      if (!needed) {
        return [...variants].slice(0, this.maxVariants);
      }

      const llmVariants = await this.rewriteWithLlmVariants(normalized, needed);
      for (const variant of llmVariants) {
        variants.add(variant);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown rewrite error';
      this.logger.warn(`LLM variant generation failed. Using deterministic variants. Reason: ${message}`);
    }

    return [...variants].slice(0, this.maxVariants);
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

  private buildDeterministicVariants(base: string): string[] {
    const variants: string[] = [];

    const keywordVariant = this.createKeywordFocusedVariant(base);
    if (keywordVariant && keywordVariant !== base) {
      variants.push(keywordVariant);
    }

    for (const decomposition of this.createSimpleDecompositionVariants(base)) {
      if (decomposition && decomposition !== base && decomposition !== keywordVariant) {
        variants.push(decomposition);
      }
    }

    const stepBack = this.createStepBackVariant(base);
    if (stepBack && stepBack !== base) {
      variants.push(stepBack);
    }

    return variants;
  }

  private createKeywordFocusedVariant(input: string): string {
    const tokens = input
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !this.stopWords.has(token));

    return this.normalizeWhitespace(tokens.join(' '));
  }

  private createSimpleDecompositionVariants(input: string): string[] {
    const separators = /\b(and|vs|versus|, then | also |\+)\b/i;
    const parts = input
      .split(separators)
      .map((part) => this.normalizeWhitespace(part))
      .filter((part) => part && !/^(and|vs|versus|, then|also|\+)$/i.test(part));

    if (parts.length < 2) {
      return [];
    }

    return parts.slice(0, 2);
  }

  private createStepBackVariant(input: string): string {
    const cleaned = this.normalizeWhitespace(input);
    if (!cleaned) {
      return '';
    }

    if (/^(how|why|when|what|which|who)\b/i.test(cleaned)) {
      return `Core concepts and best practices for: ${cleaned}`;
    }

    return `Overview and key concepts: ${cleaned}`;
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

  private async rewriteWithLlmVariants(query: string, count: number): Promise<string[]> {
    const prompt = [
      'Rewrite the user query for retrieval in a RAG system.',
      'Rules:',
      '1) Keep intent unchanged.',
      '2) Remove irrelevant conversational filler.',
      '3) Preserve domain nouns and key constraints.',
      `4) Return exactly ${count} rewritten query variants.`,
      '5) Output one variant per line with no numbering.',
      '6) If query is compound, include at least one decomposition variant.',
      '7) Include one higher-level step-back variant.',
      `User query: ${query}`,
      'Rewritten queries:',
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

    const raw = String(response?.data?.response ?? '');
    return raw
      .split('\n')
      .map((line) => this.normalizeWhitespace(line.replace(/^[-*\d.)\s]+/, '')))
      .filter((line) => line.length > 4)
      .slice(0, count);
  }
}
