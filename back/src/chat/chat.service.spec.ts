import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { VectorService } from 'src/vector/vector.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { QueryRewriterService } from './query-rewriter.service';
import { EvaluationLoggerService } from 'src/evaluation/evaluation-logger.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: any;
  let vector: any;
  let queryRewriter: any;
  let evaluationLogger: any;

  beforeEach(async () => {
    prisma = {
      chatSession: { findUnique: jest.fn(), create: jest.fn() },
      chatMessage: { create: jest.fn(), findMany: jest.fn() },
      chatCitation: { create: jest.fn() },
      $queryRawUnsafe: jest.fn(),
    };
    vector = {
      createBatchEmbeddings: jest.fn(),
      createSingleTextVector: jest.fn(),
      searchHybridChunks: jest.fn(),
      fuseMultiQueryResults: jest.fn(),
    };
    queryRewriter = { buildQueryVariants: jest.fn(), rewriteForRetrieval: jest.fn() };
    evaluationLogger = { logTurn: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: VectorService, useValue: vector },
        { provide: QueryRewriterService, useValue: queryRewriter },
        { provide: EvaluationLoggerService, useValue: evaluationLogger },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reuses an existing session token', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({ id: 'session-id', sessionToken: 'known' });
    await expect(service.getOrCreateSession('known')).resolves.toEqual({ id: 'session-id', sessionToken: 'known' });
    expect(prisma.chatSession.create).not.toHaveBeenCalled();
  });

  it('creates a session when the token is new', async () => {
    prisma.chatSession.findUnique.mockResolvedValue(null);
    prisma.chatSession.create.mockResolvedValue({ id: 'session-id', sessionToken: 'new-token' });
    await expect(service.getOrCreateSession('new-token')).resolves.toEqual({ id: 'session-id', sessionToken: 'new-token' });
    expect(prisma.chatSession.create).toHaveBeenCalledWith({ data: { sessionToken: 'new-token', title: 'Chat' } });
  });

  it('extracts an exact requested list count', () => {
    const constraint = (service as any).extractOutputConstraint('Give me 3 examples of retrieval methods');
    expect(constraint.requestedCount).toBe(3);
    expect(constraint.listRequired).toBe(true);
  });

  it('rejects a list that does not meet the requested count', () => {
    const constraint = (service as any).extractOutputConstraint('Give me 3 examples of retrieval methods');
    expect((service as any).validateReplyAgainstConstraint('1. Dense\n2. Keyword', constraint)).toBe(false);
    expect((service as any).validateReplyAgainstConstraint('1. Dense retrieval\n2. Keyword search\n3. Hybrid method', constraint)).toBe(true);
  });

  it('limits oversized context', () => {
    const text = 'x'.repeat(9500);
    expect((service as any).limitContext(text)).toHaveLength(9000);
  });

  it('requests grounded verification for multi-part factual questions', () => {
    expect((service as any).shouldVerifyGrounding('Give all split sizes and scores')).toBe(true);
    expect((service as any).shouldVerifyGrounding('List the supported formats and technologies')).toBe(true);
    expect((service as any).shouldVerifyGrounding('What is the GPA?')).toBe(false);
  });

  it('ranks chunks with direct question-term coverage ahead of weak matches', () => {
    const chunks = [
      { id: 'weak', content: 'General project history and unrelated work.' },
      { id: 'strong', content: 'The README supports PDF HTML Markdown and TXT formats.' },
    ];

    const ranked = (service as any).rankChunksForContext('Which README document formats are supported?', chunks);

    expect(ranked[0].id).toBe('strong');
  });

  it('removes internal source labels from the final reply', () => {
    const reply = (service as any).sanitizeReply('According to Source 2:\nThe result was 92% (Source 2).');
    expect(reply).toBe('The result was 92%.');
  });

  it('builds a prompt that forbids unsupported inference and project mixing', async () => {
    jest.spyOn(service, 'getOrCreateSession').mockResolvedValue({ id: 'session-id', sessionToken: 'session' } as any);
    jest.spyOn(service, 'storeMessage').mockResolvedValue({} as any);
    jest.spyOn(service as any, 'retrieveWithContextFusion').mockResolvedValue({
      topChunks: [{ id: 'chunk', documentId: 'doc', chunkIndex: 0, similarity: 0.8, content: 'DHC-MARCH reached 92% validation accuracy.' }],
      telemetry: { mode: 'fusion', variantCount: 1, successfulVariantCount: 1, fallbackUsed: false, variantGenerationMs: 0, embeddingMs: 1, searchMs: 1, fusionMs: 0, retrievalMs: 2, topChunkIds: ['chunk'], topChunkSimilarities: [0.8] },
    });
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'chunk', documentId: 'doc', chunkIndex: 0, content: 'DHC-MARCH reached 92% validation accuracy.' },
    ]);
    prisma.chatMessage.findMany.mockResolvedValue([]);

    const result = await (service as any).buildPromptAndContext('session', 'What was the DHC-MARCH accuracy?');

    expect(result.prompt).toContain('Answer only with facts supported by the provided context');
    expect(result.prompt).toContain('Never substitute a metric from another project');
    expect(result.prompt).toContain('DHC-MARCH reached 92% validation accuracy');
  });
});
