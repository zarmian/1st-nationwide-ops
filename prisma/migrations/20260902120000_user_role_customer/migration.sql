-- Add the CUSTOMER role for the read-only client portal.
-- Kept in its own migration so the new enum value is committed before the
-- column that will reference role=CUSTOMER rows is added (avoids Postgres'
-- "unsafe use of new enum value" in the same transaction).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CUSTOMER';
