import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  const chatService = {
    getOrCreateSession: jest.fn(),
    handleUserMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('creates a public session token', async () => {
    chatService.getOrCreateSession.mockResolvedValue({ sessionToken: 'session-1' });
    await expect(controller.createSession({})).resolves.toEqual({ sessionToken: 'session-1' });
  });

  it('passes the session and message to the chat service', async () => {
    chatService.handleUserMessage.mockResolvedValue({ reply: 'answer', citations: [] });
    await expect(controller.message({ sessionToken: 'session-1', message: 'question' }))
      .resolves.toEqual({ reply: 'answer', citations: [] });
    expect(chatService.handleUserMessage).toHaveBeenCalledWith('session-1', 'question');
  });
});
