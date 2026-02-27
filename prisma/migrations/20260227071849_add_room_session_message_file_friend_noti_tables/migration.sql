/*
  Warnings:

  - The values [ONLINE,OFFLINE] on the enum `UserStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('WORKSPACE', 'MEETING', 'FOCUS');

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('STUDY', 'MEETING', 'WORKSHOP', 'SOCIAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('HOST', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'LEFT', 'KICKED');

-- CreateEnum
CREATE TYPE "SessionEventType" AS ENUM ('SESSION_STARTED', 'SESSION_ENDED', 'SESSION_CANCELLED', 'USER_JOINED', 'USER_LEFT', 'USER_KICKED', 'SESSION_LOCKED', 'SESSION_UNLOCKED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'FILE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('LECTURE_NOTES', 'PAST_EXAMS', 'ASSIGNMENTS', 'SOLUTIONS', 'CHEAT_SHEETS', 'TUTORIAL', 'RESOURCE', 'MISC');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'ROOM_INVITE', 'SESSION_INVITE', 'SYSTEM');

-- AlterEnum
BEGIN;
CREATE TYPE "UserStatus_new" AS ENUM ('AVAILABLE', 'BUSY', 'AWAY', 'DO_NOT_DISTURB', 'FOCUS');
ALTER TABLE "public"."User" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus_new" USING ("status"::text::"UserStatus_new");
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "public"."UserStatus_old";
COMMIT;

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" VARCHAR(255) NOT NULL,
    "lastName" VARCHAR(255) NOT NULL,
    "profilePicture" TEXT,
    "avatarPreset" TEXT NOT NULL DEFAULT 'avatar1',
    "status" "UserStatus" NOT NULL DEFAULT 'AVAILABLE',
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" "RoomType" NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "accessType" "AccessType" NOT NULL DEFAULT 'PUBLIC',
    "password" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "thumbnail" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roomId" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" "SessionType" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledStartTime" TIMESTAMP(3),
    "actualStartTime" TIMESTAMP(3),
    "actualEndTime" TIMESTAMP(3),
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'PARTICIPANT',
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "eventType" "SessionEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roomId" UUID,
    "senderId" UUID NOT NULL,
    "recipientId" UUID,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "reactions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "category" "FileCategory" NOT NULL DEFAULT 'MISC',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "yearLevel" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" UUID NOT NULL,
    "roomId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requesterId" UUID NOT NULL,
    "addresseeId" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "actionUrl" TEXT,
    "sourceId" TEXT,
    "sourceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "session_participants_sessionId_idx" ON "session_participants"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_participants_sessionId_userId_key" ON "session_participants"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "session_logs_sessionId_idx" ON "session_logs"("sessionId");

-- CreateIndex
CREATE INDEX "messages_roomId_createdAt_idx" ON "messages"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_senderId_recipientId_idx" ON "messages"("senderId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE INDEX "files_roomId_category_idx" ON "files"("roomId", "category");

-- CreateIndex
CREATE INDEX "files_uploadedById_idx" ON "files"("uploadedById");

-- CreateIndex
CREATE INDEX "friendships_addresseeId_status_idx" ON "friendships"("addresseeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_requesterId_addresseeId_key" ON "friendships"("requesterId", "addresseeId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
