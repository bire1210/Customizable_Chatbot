import { ApiProperty } from '@nestjs/swagger';

export class DocumentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  filename: string;

  @ApiProperty()
  createdAt: Date;
}

export class DocumentChunkDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  documentId: string;

  @ApiProperty()
  content: string;
}
