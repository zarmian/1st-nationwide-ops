/**
 * One-off backfill: encrypt any plaintext alarm/padlock codes into the
 * `*Enc` columns and null out the plaintext columns.
 *
 *   ENCRYPTION_KEY=<base64-32-bytes> npm run db:encrypt-codes
 *
 * Idempotent: skips rows whose plaintext is already null. Safe to re-run.
 * Run this *after* deploying the code change that writes encrypted on save
 * but *before* (eventually) dropping the plaintext columns.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { encryptString } from "../src/lib/crypto";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY is not set — aborting.");
    process.exit(2);
  }
  const rows = await prisma.accessInstruction.findMany({
    where: {
      OR: [{ alarmCode: { not: null } }, { padlockCode: { not: null } }],
    },
    select: { id: true, alarmCode: true, padlockCode: true },
  });
  console.log(`Found ${rows.length} rows with plaintext access codes`);

  let updated = 0;
  for (const r of rows) {
    await prisma.accessInstruction.update({
      where: { id: r.id },
      data: {
        alarmCodeEnc: encryptString(r.alarmCode),
        padlockCodeEnc: encryptString(r.padlockCode),
        alarmCode: null,
        padlockCode: null,
      },
    });
    updated++;
  }
  console.log(`Encrypted ${updated} rows; plaintext fields cleared.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
