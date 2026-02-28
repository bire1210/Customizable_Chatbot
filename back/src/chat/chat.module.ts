import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VectorModule } from 'src/vector/vector.module';
import { DocumentsModule } from 'src/documents/documents.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [VectorModule, DocumentsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  // exports: [ChatService]
})
export class ChatModule {}
