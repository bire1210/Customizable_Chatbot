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

    try {
      this.sendResponse(client, 'chat-start', { sessionToken: sessionToken ?? null });

      const result = await this.chat.handleUserMessageStream(
        sessionToken,
        message,
        (chunk: string) => {
          this.sendResponse(client, 'chat-chunk', { chunk });
        },
      );

      this.sendResponse(client, 'chat-end', {
        sessionToken: result.sessionToken,
        ...result.response,
      });

      // Keep compatibility for clients listening to the old event.
      this.sendResponse(client, 'chat-response', result.response);

      return { event: 'chat-end', data: { sessionToken: result.sessionToken, ...result.response } };
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : 'Unknown streaming error';
      this.sendResponse(client, 'chat-error', { message: messageText });
      return { event: 'chat-error', data: { message: messageText } };
    }
  }

  private sendResponse(client: Socket, event: string, payload: any) {
    console.log(`emitting '${event}' to ${client.id}`);
    client.emit(event, payload);
  }
}