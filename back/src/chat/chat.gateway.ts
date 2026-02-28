import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, OnGatewayConnection } from '@nestjs/websockets';
import { ChatService } from './chat.service';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway {
  constructor(private chat: ChatService) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: WebSocket) {
    console.log('Client connected');
  }

  @SubscribeMessage('chat')
  async handleChat(@MessageBody() data: string) {
    const response = await this.chat.handleMessage(data);
    return response;
  }
}