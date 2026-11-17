import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns users without password fields', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@example.com', name: 'A', role: 'USER' }]);
    await expect(service.getAllUsers()).resolves.toHaveLength(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, email: true, name: true, role: true },
    }));
  });

  it('uses USER as the default role for a new account', async () => {
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data, password: undefined }));
    await service.createUser({ email: 'a@example.com', password: 'secret1', name: 'A' });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'USER' }),
    }));
  });

  it('rejects deletion when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.deleteUser('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an existing user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.user.delete.mockResolvedValue({ id: 'u1' });
    await expect(service.deleteUser('u1')).resolves.toEqual({ message: 'User deleted' });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });
});
