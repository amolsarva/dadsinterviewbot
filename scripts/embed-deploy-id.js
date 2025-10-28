// scripts/embed-deploy-id.js
import fs from "fs";

const { DEPLOY_ID } = process.env;
if (!DEPLOY_ID) {
  console.error("No DEPLOY_ID detected at build time.");
  process.exit(1);
}

// write to a small file under .next or app/lib
fs.writeFileSync(".next/deploy-id.json", JSON.stringify({ deployID: DEPLOY_ID }));
console.log("✅ Embedded deploy ID:", DEPLOY_ID);
