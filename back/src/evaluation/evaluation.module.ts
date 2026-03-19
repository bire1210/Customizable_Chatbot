import { Module } from '@nestjs/common';
import { EvaluationController } from './evaluation.controller';
import { EvaluationAnalyticsService } from './evaluation-analytics.service';

@Module({
  controllers: [EvaluationController],
  providers: [EvaluationAnalyticsService],
  exports: [EvaluationAnalyticsService],
})
export class EvaluationModule {}
