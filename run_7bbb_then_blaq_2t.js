import { spawn } from "node:child_process";

function runScript(script) {
  return new Promise((resolve, reject) => {
    console.log(`\n========================================`);
    console.log(`▶️ STARTING: ${script}`);
    console.log(`========================================\n`);
    const proc = spawn("node", [script], { stdio: "inherit" });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

async function main() {
  console.log("🚀 Starting Queue: 7bbb (50B) -> Blaq (2T)...\n");
  
  // 1. Send 50B to 7bbb92aee00547e1ae4a
  await runScript("pipeline_miles_to_7bbb_50b.js");
  
  // 2. Send 2T to Blaq (7785cae4f157450490d5)
  await runScript("pipeline_miles_to_blaq_2t_fresh.js");
  
  console.log("\n🎉 ALL TRANSFERS FINISHED!");
}

main().catch(console.error);
