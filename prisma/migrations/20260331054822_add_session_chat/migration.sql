-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'IMAGE';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "sessionId" UUID;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
