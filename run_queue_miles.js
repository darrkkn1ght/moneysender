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
  console.log("🚀 Starting MilesPete Transfer Queue...\n");
  
  // Job 1: 434f9571faa840c1bc4c (200B)
  await runScript("pipeline_miles_to_434f_200b.js");
  
  // Job 2: 712e924948a84d57a6d7 (200B)
  await runScript("pipeline_miles_to_712e_200b.js");
  
  console.log("\n🎉 ALL QUEUED TRANSFERS COMPLETED SUCCESSFULLY!");
}

main().catch(console.error);
