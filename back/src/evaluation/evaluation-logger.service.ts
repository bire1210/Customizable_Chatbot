import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type RetrievalTelemetry = {
  mode: 'single' | 'fusion';
  variantCount: number;
  successfulVariantCount: number;
  fallbackUsed: boolean;
  variantGenerationMs: number;
  embeddingMs: number;
  searchMs: number;
  fusionMs: number;
  retrievalMs: number;
  topChunkIds: string[];
  topChunkSimilarities: number[];
};

export type TurnEvaluationEvent = {
  timestamp: string;
  requestId: string;
  sessionToken: string;
  channel: 'ws' | 'http' | 'unknown';
  clientId?: string;
  questionLength: number;
  replyLength: number;
  streamedChunkCount: number;
  contextChars: number;
  citationCount: number;
  turnLatencyMs: number;
  generationMs: number;
  persistenceMs: number;
  retrieval: RetrievalTelemetry;
  success: boolean;
  errorMessage?: string;
};

@Injectable()
export class EvaluationLoggerService {
  private readonly logger = new Logger(EvaluationLoggerService.name);
  private readonly enabled = process.env.EVAL_LOG_ENABLED !== 'false';
  private readonly logFile = resolve(process.env.EVAL_LOG_FILE ?? 'eval-runs/online-turn-eval.jsonl');

  async logTurn(event: TurnEvaluationEvent): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await mkdir(dirname(this.logFile), { recursive: true });
      await appendFile(this.logFile, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown logging error';
      this.logger.warn(`Failed to write evaluation event: ${message}`);
    }
  }
}
