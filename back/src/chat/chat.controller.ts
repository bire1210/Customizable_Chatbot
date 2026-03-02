import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './Dtos/chat-request.dto';
import { CreateSessionDto } from './Dtos/create-session.dto';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiBody, ApiOperation } from '@nestjs/swagger';

@Controller('chat')
export class ChatController {
    constructor(private chatService: ChatService) {}

    @Public()
    @Post('session')
    @ApiBody({ type: CreateSessionDto })
    @ApiOperation({ summary: 'Create a new chat session' })
    async createSession(@Body() body: CreateSessionDto) {
        const session = await this.chatService.getOrCreateSession(undefined);
        return { sessionToken: session.sessionToken };
    }

    @Public()
    @Post('message')
    @ApiOperation({ summary: 'Send a message to the chatbot' })
    @ApiBody({ type: ChatRequestDto })
    async message(@Body() body: ChatRequestDto) {
        const resp = await this.chatService.handleUserMessage(body.sessionToken, body.message);
        return resp;
    }
}
