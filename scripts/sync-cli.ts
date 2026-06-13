import { syncFixtures } from "../lib/sync";

// CLI wrapper so we can test the ESPN sync without booting Next.
// Usage: npm run sync           (full tournament window)
//        npm run sync -- 20260613   (single date, for debugging)
async function main() {
  const dates = process.argv[2];
  const result = await syncFixtures(dates ? { dates } : undefined);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
