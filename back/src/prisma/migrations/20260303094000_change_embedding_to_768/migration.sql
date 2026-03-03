-- For switching from vector(1536) to vector(768), existing 1536-dim rows must be removed first.
DELETE FROM "DocumentChunk";

ALTER TABLE "DocumentChunk"
ALTER COLUMN "embedding" TYPE vector(768);
