-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('PATROL', 'VPI');

-- AlterTable
ALTER TABLE "PatrolSchedule" ADD COLUMN "kind" "ScheduleKind" NOT NULL DEFAULT 'PATROL';

-- CreateIndex
CREATE INDEX "PatrolSchedule_kind_idx" ON "PatrolSchedule"("kind");

-- AlterTable
ALTER TABLE "AccessInstruction" ADD COLUMN "alarmCode" TEXT;
ALTER TABLE "AccessInstruction" ADD COLUMN "padlockCode" TEXT;
