/**
 * CLI entry point for the demo seeder. Same logic as
 * /api/admin/seed-demo but runnable from a terminal.
 *
 *   npm run db:seed:demo            # idempotent, refuses if already seeded
 *   npm run db:seed:demo -- --reset # wipe demo rows first, then reseed
 */
import "dotenv/config";
import { runDemoSeed } from "../src/lib/demoSeed";

const reset = process.argv.includes("--reset");

async function main() {
  const result = await runDemoSeed({ reset });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
