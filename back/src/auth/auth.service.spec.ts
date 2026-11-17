import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns a token without exposing the password', async () => {
    const password = await bcrypt.hash('secret1', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'user@example.com', password, name: 'User', role: 'USER',
    });

    const result = await service.signIn({ email: 'user@example.com', password: 'secret1' });

    expect(result).toEqual({
      id: 'user-1', email: 'user@example.com', name: 'User', role: 'USER', access_token: 'signed-token',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ username: 'user@example.com', sub: 'user-1', role: 'USER' });
  });

  it('rejects an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.signIn({ email: 'missing@example.com', password: 'secret1' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an incorrect password', async () => {
    const password = await bcrypt.hash('correct-password', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'user@example.com', password, role: 'USER',
    });
    await expect(service.signIn({ email: 'user@example.com', password: 'wrong-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
