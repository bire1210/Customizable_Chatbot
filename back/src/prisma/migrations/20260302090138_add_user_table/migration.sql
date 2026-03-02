/*
  Warnings:

  - You are about to drop the column `timestamp` on the `ChatMessage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ChatMessage" DROP COLUMN "timestamp",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ChatSession" ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "title" DROP NOT NULL;
