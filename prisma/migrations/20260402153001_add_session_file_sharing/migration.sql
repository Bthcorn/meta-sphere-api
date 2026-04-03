-- AlterTable
ALTER TABLE "files" ADD COLUMN     "sessionId" UUID;

-- CreateIndex
CREATE INDEX "files_sessionId_createdAt_idx" ON "files"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
