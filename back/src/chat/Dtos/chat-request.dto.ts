import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class ChatRequestDto {
  @IsOptional()
  @IsString()
  sessionToken?: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}
