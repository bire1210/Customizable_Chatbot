import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SeedService {
    constructor(private prisma: PrismaService) {}

    async run() {
        const result = await this.prisma.user.upsert({
            where: { email: 'admin@gmail.com' },
            update: {},
            create: {
                email: 'admin@gmail.com',
                password: 'admin123',
                name: 'kaleab',
                role: 'ADMIN',
            },
        });

        console.log(result)
    }

}
