import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { EvaluationAnalyticsService } from './evaluation-analytics.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly analytics: EvaluationAnalyticsService) {}

  @Get('summary')
  async getSummary(@Query('days') daysParam?: string, @Query('limit') limitParam?: string) {
    const days = this.clampNumber(daysParam, 7, 1, 90);
    const limit = this.clampNumber(limitParam, 5000, 100, 50000);
    return this.analytics.getSummary(days, limit);
  }

  private clampNumber(value: string | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.floor(parsed)));
  }
}
