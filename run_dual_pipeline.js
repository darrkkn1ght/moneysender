import { runMilesToBlaq } from "./pipeline_miles_to_blaq_5t.js";
import { runBlaqTo7e79 } from "./pipeline_blaq_to_7e79_5t.js";

async function main() {
  console.log("==================================================");
  console.log("🚀 STARTING DUAL-ACCOUNT PARALLEL MONEY PIPELINE");
  console.log("  • Thread 1: @milespete -> @blaqsebastian (5 Trillion)");
  console.log("  • Thread 2: @blaqsebastian -> 7e791760cd644f13ba5a (5 Trillion)");
  console.log("==================================================\n");

  await Promise.all([
    runMilesToBlaq().catch(err => console.error("[Pipeline 1 Error]:", err)),
    runBlaqTo7e79().catch(err => console.error("[Pipeline 2 Error]:", err))
  ]);

  console.log("\n==================================================");
  console.log("🎉 DUAL PIPELINE FULLY COMPLETED!");
  console.log("==================================================");
}

main().catch(console.error);
