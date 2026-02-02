import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthService {
    constructor (private usersService: UsersService, private jwtService: JwtService) {}

    async signIn(username: string, pass:string) {
        const user = await this.usersService.findOne(username);

        if (user?.password !== pass) {
      throw new UnauthorizedException();
    }
    const { password, ...result } = user;

    // sign token
    const token = await this.jwtService.signAsync({ username: user.username, sub: user.userId });
    result['access_token'] = token;
    return result;
    }
}
