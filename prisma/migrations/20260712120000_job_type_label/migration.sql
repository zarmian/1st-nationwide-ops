-- Store the specific job sub-type label the operator picked (e.g. "Intruder
-- alarm" vs "Camera activation") when a JobType code has several option
-- aliases. Null = use the canonical label for the code.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "typeLabel" TEXT;
