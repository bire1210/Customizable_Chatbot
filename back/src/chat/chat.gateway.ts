import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

import { ChatService } from './chat.service';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  constructor(private chat: ChatService) {}

  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    console.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket, reason?: string) {
    console.log(`Client disconnected: ${client.id}` + (reason ? ` (reason: ${reason})` : ''));
  }

  @SubscribeMessage('chat')
  async handleChat(client: Socket, @MessageBody() data: any) {
    // data may be { sessionToken?, message }
    let sessionToken: string | undefined = undefined;
    let message: string;

    if (typeof data === 'string') {
      message = data;
    } else {
      sessionToken = data?.sessionToken;
      message = data?.message;
    }

    console.log(`received 'chat' from ${client.id}`, { sessionToken, message });

    const response = await this.chat.handleUserMessage(sessionToken, message);

    this.sendResponse(client, 'chat-response', response);

    return { event: 'chat-response', data: response };
  }

  private sendResponse(client: Socket, event: string, payload: any) {
    console.log(`emitting '${event}' to ${client.id}`);
    client.emit(event, payload);
  }
}