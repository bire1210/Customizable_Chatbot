import { MessageBody, SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";

@WebSocketGateway({cors: { origin: '*' }, transports: ['websocket'] })
export class chatGateway {

    @SubscribeMessage('events')
    handleEvent(@MessageBody() data: string): string {
    return data;
}
}