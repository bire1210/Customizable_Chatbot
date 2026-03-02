import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './Dtos/chat-request.dto';
import { CreateSessionDto } from './Dtos/create-session.dto';
import { Public } from 'src/common/decorators/public.decorator';

@Controller('chat')
export class ChatController {
    constructor(private chatService: ChatService) {}

    @Public()
    @Post('session')
    async createSession(@Body() body: CreateSessionDto) {
        const session = await this.chatService.getOrCreateSession(undefined);
        return { sessionToken: session.sessionToken };
    }

    @Public()
    @Post('message')
    async message(@Body() body: ChatRequestDto) {
        const resp = await this.chatService.handleUserMessage(body.sessionToken, body.message);
        return resp;
    }
}
