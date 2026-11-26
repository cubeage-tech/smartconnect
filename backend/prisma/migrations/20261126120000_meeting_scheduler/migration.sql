-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('VIDEO', 'AUDIO');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'ENDED');

-- CreateEnum
CREATE TYPE "MeetingResponse" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "MeetingRole" AS ENUM ('ORGANIZER', 'ATTENDEE');

-- AlterTable
ALTER TABLE "WorkNotification" ADD COLUMN     "meetingId" TEXT;

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "organizerId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'VIDEO',
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reminderMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "cancelledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MeetingRole" NOT NULL DEFAULT 'ATTENDEE',
    "response" "MeetingResponse" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingReminder" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_startsAt_idx" ON "Meeting"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "Meeting_organizerId_idx" ON "Meeting"("organizerId");

-- CreateIndex
CREATE INDEX "Meeting_channelId_idx" ON "Meeting"("channelId");

-- CreateIndex
CREATE INDEX "MeetingParticipant_userId_response_idx" ON "MeetingParticipant"("userId", "response");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingParticipant_meetingId_userId_key" ON "MeetingParticipant"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "MeetingReminder_sentAt_remindAt_idx" ON "MeetingReminder"("sentAt", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingReminder_meetingId_minutesBefore_key" ON "MeetingReminder"("meetingId", "minutesBefore");

-- CreateIndex
CREATE INDEX "WorkNotification_meetingId_idx" ON "WorkNotification"("meetingId");

-- AddForeignKey
ALTER TABLE "WorkNotification" ADD CONSTRAINT "WorkNotification_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReminder" ADD CONSTRAINT "MeetingReminder_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity the schema language cannot express (kept here so a direct write
-- can't bypass the API's validation either).
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_endsAt_after_startsAt" CHECK ("endsAt" > "startsAt");
ALTER TABLE "MeetingReminder" ADD CONSTRAINT "MeetingReminder_minutesBefore_allowed" CHECK ("minutesBefore" IN (5, 10, 15, 30, 60));
