import { Test, TestingModule } from '@nestjs/testing';
import { SeedService } from './seed.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('SeedService', () => {
  let service: SeedService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { user: { upsert: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SeedService>(SeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('upserts the default administrator', async () => {
    prisma.user.upsert.mockResolvedValue({ id: 'admin', email: 'admin@gmail.com' });
    await service.run();
    expect(prisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: 'admin@gmail.com' },
      create: expect.objectContaining({ email: 'admin@gmail.com', role: 'ADMIN' }),
    }));
  });
});
