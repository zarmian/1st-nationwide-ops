/**
 * Nexus CSV importer (CLI). Thin wrapper around src/lib/nexusImport.ts so
 * the same logic powers the admin upload page.
 *
 *   npm run db:import:nexus -- /absolute/path/to/nexus_sites.csv
 *
 * Required env: DATABASE_URL, DIRECT_URL
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runNexusImport } from "../src/lib/nexusImport";

const prisma = new PrismaClient();

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: npm run db:import:nexus -- /absolute/path/to/nexus_sites.csv",
    );
    process.exit(2);
  }
  const absPath = resolve(path);
  if (!existsSync(absPath)) {
    console.error(`CSV not found: ${absPath}`);
    process.exit(2);
  }
  console.log(`Importing Nexus sites from ${absPath}`);

  const csvText = readFileSync(absPath, "utf8");
  const result = await runNexusImport(prisma, csvText);

  console.log(`\nDone:`);
  console.log(`  ✓ ${result.created} sites created`);
  console.log(`  ✓ ${result.updated} sites updated`);
  console.log(`  ✓ ${result.ratesWritten} rate rows written`);
  if (result.skipped.length > 0) {
    console.log(`  ! ${result.skipped.length} rows skipped:`);
    for (const s of result.skipped.slice(0, 10)) {
      console.log(`    - ${s.reference ?? "(no ref)"}: ${s.reason}`);
    }
    if (result.skipped.length > 10) {
      console.log(`    … and ${result.skipped.length - 10} more`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
