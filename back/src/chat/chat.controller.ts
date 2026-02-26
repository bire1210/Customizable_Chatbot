import { Body, Controller, Get, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatDto } from './Dtos/chat.dto';

@Controller('chat')
export class ChatController {
    constructor(private chatService: ChatService) {}
    @Post()
    async chat(@Body() body: ChatDto) {
        const response = await this.chatService.handleMessage(body.message);

        return response;
    }

}
