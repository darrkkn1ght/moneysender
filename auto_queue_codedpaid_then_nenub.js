import fs from "node:fs";
import { spawn } from "node:child_process";

const CODED_STATE = "./balances_trio_codedpaid_1t.json";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log("👀 Watching CODEDPAID_ pipeline to finish before launching Nenu_B 1T...");
  while (true) {
    try {
      const state = JSON.parse(fs.readFileSync(CODED_STATE, "utf8"));
      if (state.remaining <= 0 || state.totalDelivered >= state.totalTarget) {
        console.log(`\n🎉 CODEDPAID_ 1T complete (Delivered: ₦${(state.totalDelivered / 1e12).toFixed(2)}T)!`);
        console.log("🚀 Launching True Trio 1.0T to @Nenu_B (cb58ecf67aa04729b590) immediately!\n");

        const child = spawn("node", ["pipeline_trio_to_nenub_1t.js"], {
          stdio: "inherit",
          detached: false
        });

        child.on("exit", code => {
          console.log(`🏆 Nenu_B pipeline exited with code ${code}`);
          process.exit(code || 0);
        });
        break;
      }
    } catch {}
    await sleep(3000);
  }
}

main().catch(console.error);
