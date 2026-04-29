-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCHER', 'OFFICER');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('COMMERCIAL', 'RESIDENTIAL', 'RETAIL', 'STORAGE', 'INDUSTRIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceTag" AS ENUM ('ALARM_RESPONSE', 'KEYHOLDING', 'LOCKUP', 'UNLOCK', 'VPI', 'PATROL', 'STATIC_GUARDING', 'DOG_HANDLER', 'ADHOC');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('CORPORATE', 'RESIDENTIAL', 'RESELLER');

-- CreateEnum
CREATE TYPE "KeyType" AS ENUM ('KEY', 'FOB', 'PADLOCK', 'CODE');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('WITH_US', 'WITH_OFFICER', 'WITH_CUSTOMER', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "PatrolFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "OnboardingStage" AS ENUM ('PROPOSED', 'SURVEY', 'FRONT_KEY', 'SHUTTER_KEY', 'ALARM_FOB', 'GO_LIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerProgram" AS ENUM ('TESCO', 'SHURGARD', 'OTHER');

-- CreateEnum
CREATE TYPE "AlarmSource" AS ENUM ('ARC_EMAIL', 'ARC_PHONE', 'PARTNER_EMAIL', 'PARTNER_PHONE', 'CUSTOMER_PHONE', 'MANUAL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "PartnerRole" AS ENUM ('CUSTOMER', 'SUBCONTRACTOR', 'BOTH');

-- CreateEnum
CREATE TYPE "PartnerChannel" AS ENUM ('EMAIL', 'PHONE', 'THEIR_APP', 'WHATSAPP', 'PORTAL');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ALARM_RESPONSE', 'PATROL', 'LOCK', 'UNLOCK', 'KEY_COLLECTION', 'KEY_DROPOFF', 'VPI', 'ADHOC', 'STATIC_GUARDING_SHIFT', 'DOG_HANDLER_SHIFT');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('SCHEDULED', 'ALARM', 'PARTNER_REQUEST', 'CUSTOMER_REQUEST', 'AD_HOC');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REVIEW_PENDING', 'APPROVED', 'SENT_TO_CLIENT', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResponderType" AS ENUM ('INTERNAL_OFFICER', 'PARTNER', 'EXTERNAL_NAMED');

-- CreateEnum
CREATE TYPE "SubmissionForm" AS ENUM ('ALARM_RESPONSE', 'PATROL', 'LOCK', 'UNLOCK', 'KEY_COLLECTION', 'KEY_DROPOFF', 'VPI', 'ADHOC');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED_AND_APPROVED');

-- CreateEnum
CREATE TYPE "ReportChannel" AS ENUM ('EMAIL', 'PORTAL_DOWNLOAD', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlarmPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlarmOutcome" AS ENUM ('FALSE_ALARM', 'GENUINE', 'RESOLVED', 'ESCALATED_TO_POLICE', 'OTHER');

-- CreateTable
CREATE TABLE "Region" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "leadUserId" UUID,
    "notes" TEXT,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "regionId" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "onDuty" BOOLEAN NOT NULL DEFAULT false,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'CORPORATE',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "billingAddress" TEXT,
    "contractRef" TEXT,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT,
    "name" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "postcodeFormatted" TEXT NOT NULL,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "type" "SiteType" NOT NULL DEFAULT 'COMMERCIAL',
    "regionId" INTEGER,
    "customerId" UUID,
    "partnerId" UUID,
    "defaultResponderId" UUID,
    "services" "ServiceTag"[] DEFAULT ARRAY[]::"ServiceTag"[],
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Key" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "internalNo" TEXT,
    "label" TEXT NOT NULL,
    "type" "KeyType" NOT NULL,
    "siteId" UUID,
    "currentHolderUserId" UUID,
    "status" "KeyStatus" NOT NULL DEFAULT 'WITH_US',
    "qrId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyMovement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "keyId" UUID NOT NULL,
    "fromUserId" UUID,
    "toUserId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "notes" TEXT,
    "signedOffById" UUID,

    CONSTRAINT "KeyMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessInstruction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "alarmCodeEnc" BYTEA,
    "padlockCodeEnc" BYTEA,
    "entryStepsMd" TEXT,
    "lockboxId" TEXT,
    "hazards" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "AccessInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolSchedule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "frequency" "PatrolFrequency" NOT NULL DEFAULT 'WEEKLY',
    "assignedOfficerId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),

    CONSTRAINT "PatrolSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatrolVisit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "patrolScheduleId" UUID,
    "officerId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'PENDING',
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatrolVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockUnlockSchedule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "unlockTime" TEXT,
    "lockdownTime" TEXT,
    "days" "DayOfWeek"[] DEFAULT ARRAY[]::"DayOfWeek"[],
    "assignedOfficerId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LockUnlockSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlarmEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "source" "AlarmSource" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawSubject" TEXT,
    "rawBody" TEXT,
    "zone" TEXT,
    "priority" "AlarmPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" UUID,
    "outcome" "AlarmOutcome",
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlarmEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingPipeline" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "program" "CustomerProgram" NOT NULL,
    "stage" "OnboardingStage" NOT NULL DEFAULT 'PROPOSED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "role" "PartnerRole" NOT NULL,
    "preferred" "PartnerChannel" NOT NULL DEFAULT 'EMAIL',
    "emailIntake" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerContact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partnerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "notes" TEXT,

    CONSTRAINT "PartnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "JobType" NOT NULL,
    "source" "JobSource" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "AlarmPriority" NOT NULL DEFAULT 'MEDIUM',
    "siteId" UUID,
    "customerId" UUID,
    "partnerId" UUID,
    "responderType" "ResponderType",
    "assignedToUserId" UUID,
    "externalResponder" TEXT,
    "alarmEventId" UUID,
    "patrolVisitId" UUID,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reportedViaPartnerApp" BOOLEAN NOT NULL DEFAULT false,
    "partnerReportRef" TEXT,
    "billedAmount" DECIMAL(10,2),
    "paidAmount" DECIMAL(10,2),
    "payRateUnit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "form" "SubmissionForm" NOT NULL,
    "siteId" UUID,
    "jobId" UUID,
    "submittedByUserId" UUID,
    "officerNameRaw" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportReview" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submissionId" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "edits" JSONB,
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reviewId" UUID NOT NULL,
    "channel" "ReportChannel" NOT NULL DEFAULT 'EMAIL',
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "pdfUrl" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_regionId_role_idx" ON "User"("regionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");

-- CreateIndex
CREATE INDEX "Site_regionId_idx" ON "Site"("regionId");

-- CreateIndex
CREATE INDEX "Site_customerId_idx" ON "Site"("customerId");

-- CreateIndex
CREATE INDEX "Site_partnerId_idx" ON "Site"("partnerId");

-- CreateIndex
CREATE INDEX "Site_postcode_idx" ON "Site"("postcode");

-- CreateIndex
CREATE INDEX "Site_type_idx" ON "Site"("type");

-- CreateIndex
CREATE INDEX "Site_active_idx" ON "Site"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Key_internalNo_key" ON "Key"("internalNo");

-- CreateIndex
CREATE UNIQUE INDEX "Key_qrId_key" ON "Key"("qrId");

-- CreateIndex
CREATE INDEX "Key_siteId_idx" ON "Key"("siteId");

-- CreateIndex
CREATE INDEX "Key_currentHolderUserId_idx" ON "Key"("currentHolderUserId");

-- CreateIndex
CREATE INDEX "Key_status_idx" ON "Key"("status");

-- CreateIndex
CREATE INDEX "KeyMovement_keyId_occurredAt_idx" ON "KeyMovement"("keyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessInstruction_siteId_key" ON "AccessInstruction"("siteId");

-- CreateIndex
CREATE INDEX "PatrolSchedule_siteId_idx" ON "PatrolSchedule"("siteId");

-- CreateIndex
CREATE INDEX "PatrolSchedule_assignedOfficerId_idx" ON "PatrolSchedule"("assignedOfficerId");

-- CreateIndex
CREATE INDEX "PatrolVisit_siteId_scheduledAt_idx" ON "PatrolVisit"("siteId", "scheduledAt");

-- CreateIndex
CREATE INDEX "PatrolVisit_officerId_scheduledAt_idx" ON "PatrolVisit"("officerId", "scheduledAt");

-- CreateIndex
CREATE INDEX "PatrolVisit_status_idx" ON "PatrolVisit"("status");

-- CreateIndex
CREATE INDEX "LockUnlockSchedule_siteId_idx" ON "LockUnlockSchedule"("siteId");

-- CreateIndex
CREATE INDEX "LockUnlockSchedule_assignedOfficerId_idx" ON "LockUnlockSchedule"("assignedOfficerId");

-- CreateIndex
CREATE INDEX "AlarmEvent_siteId_receivedAt_idx" ON "AlarmEvent"("siteId", "receivedAt");

-- CreateIndex
CREATE INDEX "AlarmEvent_assignedToId_idx" ON "AlarmEvent"("assignedToId");

-- CreateIndex
CREATE INDEX "AlarmEvent_priority_idx" ON "AlarmEvent"("priority");

-- CreateIndex
CREATE INDEX "OnboardingPipeline_siteId_idx" ON "OnboardingPipeline"("siteId");

-- CreateIndex
CREATE INDEX "OnboardingPipeline_stage_idx" ON "OnboardingPipeline"("stage");

-- CreateIndex
CREATE INDEX "ActivityLog_entity_entityId_idx" ON "ActivityLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_name_key" ON "Partner"("name");

-- CreateIndex
CREATE INDEX "Partner_role_idx" ON "Partner"("role");

-- CreateIndex
CREATE INDEX "Partner_active_idx" ON "Partner"("active");

-- CreateIndex
CREATE INDEX "PartnerContact_partnerId_idx" ON "PartnerContact"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_alarmEventId_key" ON "Job"("alarmEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_patrolVisitId_key" ON "Job"("patrolVisitId");

-- CreateIndex
CREATE INDEX "Job_siteId_status_idx" ON "Job"("siteId", "status");

-- CreateIndex
CREATE INDEX "Job_assignedToUserId_status_idx" ON "Job"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "Job_customerId_idx" ON "Job"("customerId");

-- CreateIndex
CREATE INDEX "Job_partnerId_idx" ON "Job"("partnerId");

-- CreateIndex
CREATE INDEX "Job_scheduledFor_idx" ON "Job"("scheduledFor");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "FormSubmission_siteId_submittedAt_idx" ON "FormSubmission"("siteId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_jobId_idx" ON "FormSubmission"("jobId");

-- CreateIndex
CREATE INDEX "FormSubmission_submittedByUserId_idx" ON "FormSubmission"("submittedByUserId");

-- CreateIndex
CREATE INDEX "FormSubmission_form_idx" ON "FormSubmission"("form");

-- CreateIndex
CREATE UNIQUE INDEX "ReportReview_submissionId_key" ON "ReportReview"("submissionId");

-- CreateIndex
CREATE INDEX "ReportReview_status_createdAt_idx" ON "ReportReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ClientReport_reviewId_idx" ON "ClientReport"("reviewId");

-- CreateIndex
CREATE INDEX "ClientReport_status_idx" ON "ClientReport"("status");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_leadUserId_fkey" FOREIGN KEY ("leadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_defaultResponderId_fkey" FOREIGN KEY ("defaultResponderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_currentHolderUserId_fkey" FOREIGN KEY ("currentHolderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "Key"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_signedOffById_fkey" FOREIGN KEY ("signedOffById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessInstruction" ADD CONSTRAINT "AccessInstruction_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolSchedule" ADD CONSTRAINT "PatrolSchedule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolSchedule" ADD CONSTRAINT "PatrolSchedule_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolVisit" ADD CONSTRAINT "PatrolVisit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolVisit" ADD CONSTRAINT "PatrolVisit_patrolScheduleId_fkey" FOREIGN KEY ("patrolScheduleId") REFERENCES "PatrolSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatrolVisit" ADD CONSTRAINT "PatrolVisit_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockUnlockSchedule" ADD CONSTRAINT "LockUnlockSchedule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockUnlockSchedule" ADD CONSTRAINT "LockUnlockSchedule_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlarmEvent" ADD CONSTRAINT "AlarmEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlarmEvent" ADD CONSTRAINT "AlarmEvent_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingPipeline" ADD CONSTRAINT "OnboardingPipeline_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerContact" ADD CONSTRAINT "PartnerContact_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_alarmEventId_fkey" FOREIGN KEY ("alarmEventId") REFERENCES "AlarmEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_patrolVisitId_fkey" FOREIGN KEY ("patrolVisitId") REFERENCES "PatrolVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportReview" ADD CONSTRAINT "ReportReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportReview" ADD CONSTRAINT "ReportReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ReportReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

