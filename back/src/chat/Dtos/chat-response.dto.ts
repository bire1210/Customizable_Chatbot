export class ChatResponseDto {
  reply!: string;
  citations?: Array<{ documentId: string; chunkId: string; score: number }>;
}
