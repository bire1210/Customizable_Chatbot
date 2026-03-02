import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RegisterDto } from './Dtos/register.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor (private prisma: PrismaService, private jwtService: JwtService) {}

    async signIn(data) {
        const user = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
    data.password,
    user.password,
  );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, ...result } = user;

    // sign token
    const token = await this.jwtService.signAsync({ username: user.email, sub: user.id, role: user.role });
    result['access_token'] = token;
    return result;
    }

    async register(data: RegisterDto){
        const user = await this.prisma.user.create({
            data: {
                email: data.email,
                password: await bcrypt.hash(data.password, 10),
                name: data.name,
                role: "ADMIN"
            },
        });
        const { password, ...result } = user;

        // sign token
        const token = await this.jwtService.signAsync({ username: user.email, sub: user.id });
        result['access_token'] = token;
        return result;
    }
}
