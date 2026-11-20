-- QA H4: profile photo.
--  - UserProfile.avatarAttachmentId: the user's uploaded photo (nullable).
-- Additive only: one nullable column, one unique index, one foreign key
-- (ON DELETE SET NULL). No existing row changes.

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "avatarAttachmentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_avatarAttachmentId_key" ON "UserProfile"("avatarAttachmentId");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_avatarAttachmentId_fkey" FOREIGN KEY ("avatarAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
