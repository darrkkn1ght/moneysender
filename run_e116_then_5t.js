import { sendE116 } from "./index_e116_100b.js";
import { execSync } from "node:child_process";

async function runChain() {
  console.log("==========================================");
  console.log("STEP 1: Sending 100B to e1162ef87cca48f590b5");
  console.log("==========================================");
  await sendE116();

  console.log("\n==========================================");
  console.log("STEP 1 COMPLETE: 100B sent to e116!");
  console.log("STEP 2: Resuming 5T transfer to blaqsebastian (7785cae4f157450490d5)");
  console.log("==========================================\n");

  execSync("node index_7785_5t.js", { stdio: "inherit" });
}

runChain().catch(console.error);
