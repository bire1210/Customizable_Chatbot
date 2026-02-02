import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit
{
  constructor(private readonly config: ConfigService) {
    const url = config.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL is not defined');
    }

    const adapter = new PrismaPg({ connectionString: url });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('Connected to the database');
  }
}
