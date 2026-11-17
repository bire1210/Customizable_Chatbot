import { Test, TestingModule } from '@nestjs/testing';
import { VectorService } from './vector.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('VectorService', () => {
  let service: VectorService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { $queryRawUnsafe: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<VectorService>(VectorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('normalizes vector distance into bounded similarity', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'a', content: 'A', documentId: 'doc', chunkIndex: 0, distance: 0.2 },
      { id: 'b', content: 'B', documentId: 'doc', chunkIndex: 1, distance: 1.5 },
    ]);

    const results = await service.searchSimilarVectors([0.1, 0.2], 2);

    expect(results[0].similarity).toBeCloseTo(0.8);
    expect(results[1].similarity).toBe(0);
  });

  it('uses ranked OR-prefix terms for keyword recall', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await service.searchKeywordChunks('According to Kaleab, supported ingestion formats', 10);
    expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe('supported:* | ingestion:* | formats:*');
    expect(prisma.$queryRawUnsafe.mock.calls[0][2]).toBe(10);
  });

  it('merges semantic and keyword rankings without duplicating chunks', async () => {
    jest.spyOn(service, 'searchSimilarVectors').mockResolvedValue([
      { id: 'shared', content: 'shared', documentId: 'doc', chunkIndex: 0, distance: 0.1, similarity: 0.9, score: 0.02 },
      { id: 'semantic', content: 'semantic', documentId: 'doc', chunkIndex: 1, distance: 0.2, similarity: 0.8, score: 0.01 },
    ] as any);
    jest.spyOn(service, 'searchKeywordChunks').mockResolvedValue([
      { id: 'shared', content: 'shared', documentId: 'doc', chunkIndex: 0, distance: 1, similarity: 0, score: 0.03 },
      { id: 'keyword', content: 'keyword', documentId: 'doc', chunkIndex: 2, distance: 1, similarity: 0, score: 0.02 },
    ] as any);

    const results = await service.searchHybridChunks('query', [0.1], 3, 10);

    expect(results.map((item) => item.id)).toEqual(['shared', 'keyword', 'semantic']);
    expect(results[0].score).toBeCloseTo(0.05);
    expect(results[0].similarity).toBe(0.9);
  });

  it('weights the original query above later variants during fusion', () => {
    const make = (id: string, score: number) => ({
      id, content: id, documentId: id, chunkIndex: 0, distance: 0.2, similarity: 0.8, score,
    });

    const results = service.fuseMultiQueryResults([
      [make('original', 0.03)],
      [make('variant', 0.03)],
    ] as any, { topK: 2, perDocumentCap: 1 });

    expect(results[0].id).toBe('original');
  });

  it('limits repeated chunks from one document when other documents are available', () => {
    const candidates = [
      { id: 'a1', content: 'alpha one', documentId: 'a', chunkIndex: 0, distance: 0.1, similarity: 0.9, score: 0.04 },
      { id: 'a2', content: 'alpha two', documentId: 'a', chunkIndex: 1, distance: 0.2, similarity: 0.8, score: 0.03 },
      { id: 'b1', content: 'beta one', documentId: 'b', chunkIndex: 0, distance: 0.3, similarity: 0.7, score: 0.02 },
    ];

    const results = service.fuseMultiQueryResults([candidates] as any, {
      topK: 2,
      perDocumentCap: 1,
      diversityLambda: 1,
    });

    expect(new Set(results.map((item) => item.documentId)).size).toBe(2);
  });
});
