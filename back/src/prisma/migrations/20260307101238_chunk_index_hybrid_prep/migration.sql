-- DropIndex
DROP INDEX "DocumentChunk_embedding_cosine_idx";

-- AlterTable
ALTER TABLE "DocumentChunk" ALTER COLUMN "chunkIndex" DROP DEFAULT;
