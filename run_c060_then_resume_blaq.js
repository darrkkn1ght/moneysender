import { sendToC060 } from "./pipeline_miles_to_c060_1t.js";
import { spawn } from "node:child_process";

async function runChain() {
  console.log("==================================================");
  console.log("STEP 1: Sending 1.00T from Miles to c060032549234d71b906");
  console.log("==================================================");
  await sendToC060();

  console.log("\n==================================================");
  console.log("STEP 1 COMPLETE: 1.00T sent to c060032549234d71b906!");
  console.log("STEP 2: Resuming 3.00T transfer to Blaq (7785cae4f157450490d5)");
  console.log("==================================================\n");

  const child = spawn("node", ["pipeline_miles_to_blaq_3t.js"], { stdio: "inherit" });
  child.on("close", (code) => {
    console.log(`Miles to Blaq finished with exit code ${code}`);
  });
}

runChain().catch(console.error);
