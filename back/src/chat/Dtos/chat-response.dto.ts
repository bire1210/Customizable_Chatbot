export class ChatResponseDto {
  reply!: string;
  citations?: Array<{
    documentId: string;
    chunkId: string;
    chunkIndex: number;
    score: number;
    distance: number;
  }>;
}
