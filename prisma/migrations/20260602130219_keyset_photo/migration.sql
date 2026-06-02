-- Reference photo for a KeySet.
--
-- photoUrl  TEXT  Vercel Blob URL of the operator-uploaded reference
--                 photo. One per set. NULL = no photo. Existing rows
--                 are unaffected; the new UI shows an "Add photo"
--                 button when null.

ALTER TABLE "KeySet"
  ADD COLUMN "photoUrl" TEXT;
