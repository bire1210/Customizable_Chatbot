import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RetrievalTelemetry, TurnEvaluationEvent } from './evaluation-logger.service';

type DailyBucket = {
  date: string;
  turns: number;
  successfulTurns: number;
  latencies: number[];
};

@Injectable()
export class EvaluationAnalyticsService {
  private readonly logFile = resolve(process.env.EVAL_LOG_FILE ?? 'eval-runs/online-turn-eval.jsonl');

  async getSummary(days = 7, limit = 5000) {
    const allEvents = await this.readEvents(limit);
    const startAt = Date.now() - days * 24 * 60 * 60 * 1000;

    const events = allEvents
      .filter((event) => Date.parse(event.timestamp) >= startAt)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const turnLatencies = events.map((event) => event.turnLatencyMs);
    const retrievalLatencies = events.map((event) => event.retrieval.retrievalMs);
    const generationLatencies = events.map((event) => event.generationMs);

    const successfulTurns = events.filter((event) => event.success).length;
    const fusionTurns = events.filter((event) => event.retrieval.mode === 'fusion').length;
    const fallbackTurns = events.filter((event) => event.retrieval.fallbackUsed).length;

    const avgVariants = this.average(events.map((event) => event.retrieval.variantCount));
    const avgCitationCount = this.average(events.map((event) => event.citationCount));

    const modeBreakdown = [
      { label: 'Fusion', value: fusionTurns },
      { label: 'Single', value: Math.max(0, events.length - fusionTurns) },
      { label: 'Fallback', value: fallbackTurns },
    ];

    const dailyMap = new Map<string, DailyBucket>();
    for (const event of events) {
      const date = event.timestamp.slice(0, 10);
      const bucket = dailyMap.get(date) ?? {
        date,
        turns: 0,
        successfulTurns: 0,
        latencies: [],
      };

      bucket.turns += 1;
      if (event.success) {
        bucket.successfulTurns += 1;
      }
      bucket.latencies.push(event.turnLatencyMs);
      dailyMap.set(date, bucket);
    }

    const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    const recentTurns = events.slice(-40).map((event) => ({
      timestamp: event.timestamp,
      latencyMs: event.turnLatencyMs,
      retrievalMs: event.retrieval.retrievalMs,
      generationMs: event.generationMs,
      citationCount: event.citationCount,
      mode: event.retrieval.mode,
      fallback: event.retrieval.fallbackUsed,
      success: event.success,
    }));

    return {
      windowDays: days,
      overview: {
        totalTurns: events.length,
        successRate: this.safeRate(successfulTurns, events.length),
        avgTurnLatencyMs: this.average(turnLatencies),
        p50TurnLatencyMs: this.percentile(turnLatencies, 50),
        p95TurnLatencyMs: this.percentile(turnLatencies, 95),
        avgRetrievalMs: this.average(retrievalLatencies),
        avgGenerationMs: this.average(generationLatencies),
        fusionUsageRate: this.safeRate(fusionTurns, events.length),
        fallbackRate: this.safeRate(fallbackTurns, events.length),
        avgVariantCount: avgVariants,
        avgCitationCount,
      },
      series: {
        dailyTurns: daily.map((bucket) => ({
          date: bucket.date,
          turns: bucket.turns,
          successRate: this.safeRate(bucket.successfulTurns, bucket.turns),
        })),
        dailyLatency: daily.map((bucket) => ({
          date: bucket.date,
          avgLatencyMs: this.average(bucket.latencies),
          p95LatencyMs: this.percentile(bucket.latencies, 95),
        })),
        modeBreakdown,
        recentTurns,
      },
    };
  }

  private async readEvents(limit: number): Promise<TurnEvaluationEvent[]> {
    try {
      const raw = await readFile(this.logFile, 'utf8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-Math.max(1, limit));

      const events: TurnEvaluationEvent[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as TurnEvaluationEvent;
          if (!parsed?.timestamp || !parsed?.retrieval) {
            continue;
          }

          events.push(this.normalizeEvent(parsed));
        } catch {
          continue;
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  private normalizeEvent(event: TurnEvaluationEvent): TurnEvaluationEvent {
    const retrieval: RetrievalTelemetry = {
      mode: event.retrieval?.mode === 'single' ? 'single' : 'fusion',
      variantCount: event.retrieval?.variantCount ?? 0,
      successfulVariantCount: event.retrieval?.successfulVariantCount ?? 0,
      fallbackUsed: Boolean(event.retrieval?.fallbackUsed),
      variantGenerationMs: event.retrieval?.variantGenerationMs ?? 0,
      embeddingMs: event.retrieval?.embeddingMs ?? 0,
      searchMs: event.retrieval?.searchMs ?? 0,
      fusionMs: event.retrieval?.fusionMs ?? 0,
      retrievalMs: event.retrieval?.retrievalMs ?? 0,
      topChunkIds: event.retrieval?.topChunkIds ?? [],
      topChunkSimilarities: event.retrieval?.topChunkSimilarities ?? [],
    };

    return {
      ...event,
      retrieval,
      turnLatencyMs: event.turnLatencyMs ?? 0,
      generationMs: event.generationMs ?? 0,
      persistenceMs: event.persistenceMs ?? 0,
      citationCount: event.citationCount ?? 0,
      success: Boolean(event.success),
      streamedChunkCount: event.streamedChunkCount ?? 0,
      questionLength: event.questionLength ?? 0,
      replyLength: event.replyLength ?? 0,
      contextChars: event.contextChars ?? 0,
      channel: event.channel ?? 'unknown',
    };
  }

  private average(values: number[]) {
    if (!values.length) {
      return 0;
    }

    const sum = values.reduce((acc, value) => acc + value, 0);
    return Number((sum / values.length).toFixed(2));
  }

  private percentile(values: number[], percentile: number) {
    if (!values.length) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return Number(sorted[index].toFixed(2));
  }

  private safeRate(numerator: number, denominator: number) {
    if (!denominator) {
      return 0;
    }

    return Number(((numerator / denominator) * 100).toFixed(2));
  }
}
