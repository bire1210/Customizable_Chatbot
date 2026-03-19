import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VectorModule } from 'src/vector/vector.module';
import { DocumentsModule } from 'src/documents/documents.module';
import { ChatGateway } from './chat.gateway';
import { PrismaModule } from 'src/prisma/prisma.module';
import { QueryRewriterService } from './query-rewriter.service';
import { EvaluationLoggerService } from 'src/evaluation/evaluation-logger.service';

@Module({
  imports: [PrismaModule, VectorModule, DocumentsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, QueryRewriterService, EvaluationLoggerService],
})
export class ChatModule {}
