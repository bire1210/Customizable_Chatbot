import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsService } from './documents.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { VectorService } from 'src/vector/vector.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: any;
  let vector: any;

  beforeEach(async () => {
    prisma = {
      document: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
      documentChunk: { findMany: jest.fn(), deleteMany: jest.fn() },
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn(),
    };
    vector = { createBatchEmbeddings: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: VectorService, useValue: vector },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('preserves lines that do not end with punctuation', () => {
    const text = [
      'National Exit Examination 86%',
      'Measured API paths at p99 below 200 ms',
      'Training examples 5,984',
    ].join('\n');

    const chunks = service.chunkText(text, 80, 10);
    const joined = chunks.map((chunk) => chunk.content).join('\n');

    expect(joined).toContain('National Exit Examination 86%');
    expect(joined).toContain('p99 below 200 ms');
    expect(joined).toContain('Training examples 5,984');
  });

  it('keeps every source line in at least one chunk', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `record-${index} value-${index * 7}`);
    const chunks = service.chunkText(lines.join('\n'), 120, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 120)).toBe(true);
    for (const line of lines) {
      expect(chunks.some((chunk) => chunk.content.includes(line))).toBe(true);
    }
  });

  it('returns no chunks for blank input', () => {
    expect(service.chunkText('   \n\n  ')).toEqual([]);
  });

  it('embeds and inserts every generated chunk', async () => {
    const rawText = Array.from({ length: 12 }, (_, index) => `line-${index} ${'content '.repeat(12)}`).join('\n');
    const expectedChunks = service.chunkText(rawText);
    vector.createBatchEmbeddings.mockResolvedValue(
      expectedChunks.map(() => Array.from({ length: 768 }, () => 0.01)),
    );

    await service.ingestDocument({ documentId: 'doc-id', rawText });

    expect(vector.createBatchEmbeddings).toHaveBeenCalledWith(expectedChunks.map((chunk) => chunk.content));
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRawUnsafe.mock.calls[0]).toHaveLength(expectedChunks.length + 1);
  });
});
