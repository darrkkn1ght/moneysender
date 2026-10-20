import { spawn } from "node:child_process";

console.log("==================================================");
console.log("🚀 STARTING 3 CONCURRENT LAGOSLIFE TRANSFERS");
console.log("==================================================");
console.log("1. Blaq        -> 797b8baa5acc49b4a643 | Amount: 100B");
console.log("2. PrinceDavid -> 933ba08eb1d64901baf9 | Amount: 1.00T");
console.log("3. MilesPete   -> 434f9571faa840c1bc4c | Amount: 500B");
console.log("==================================================\n");

function startProcess(scriptName, label) {
  const p = spawn("node", [scriptName], { stdio: "inherit" });
  p.on("close", (code) => {
    console.log(`\n🏁 [${label}] Process exited with code ${code}`);
  });
  p.on("error", (err) => {
    console.error(`\n❌ [${label}] Error:`, err);
  });
  return p;
}

startProcess("pipeline_blaq_to_797b_100b.js", "Blaq 100B");
startProcess("pipeline_princedavid_to_933b_1t.js", "PrinceDavid 1T");
startProcess("pipeline_miles_to_434f_500b.js", "MilesPete 500B");
