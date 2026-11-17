import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = { signIn: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates login to the auth service', async () => {
    const data = { email: 'user@example.com', password: 'secret1' };
    authService.signIn.mockResolvedValue({ access_token: 'token' });
    await expect(controller.signIn(data)).resolves.toEqual({ access_token: 'token' });
    expect(authService.signIn).toHaveBeenCalledWith(data);
  });
});
