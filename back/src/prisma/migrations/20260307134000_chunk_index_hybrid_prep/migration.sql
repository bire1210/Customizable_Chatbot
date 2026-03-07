-- AlterTable
ALTER TABLE "DocumentChunk"
ADD COLUMN "chunkIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_chunkIndex_idx"
ON "DocumentChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "DocumentChunk_content_fts_idx"
ON "DocumentChunk" USING GIN (to_tsvector('english', content));

-- CreateIndex
CREATE INDEX "DocumentChunk_embedding_cosine_idx"
ON "DocumentChunk" USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
