import { Module } from '@nestjs/common';
import { SeedService } from './seed/seed.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SeedService],
  exports: [SeedService]
})
export class SeedModule {}
