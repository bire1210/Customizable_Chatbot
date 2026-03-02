import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SeedService {
    constructor(private prisma: PrismaService) {}

    async run() {
        const hashed = await bcrypt.hash('admin123', 10);
        const result = await this.prisma.user.upsert({
            where: { email: 'admin@gmail.com' },
            update: { password: hashed },
            create: {
                email: 'admin@gmail.com',
                password: hashed,
                name: 'kaleab',
                role: 'ADMIN',
            },
        });

        console.log(result)
    }

}
