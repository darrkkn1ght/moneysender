import fs from "node:fs";

const STATE_FILE = "./balances_miles_to_f3e6_2nd_1t.json";
const TOTAL = 1_000_000_000_000;
const PER_TX = 10_000_000_000;
const DELAY_SECS = 25;

function fmt(n) {
  if (n >= 1e12) return "₦" + (n / 1e12).toFixed(2) + " Trillion";
  if (n >= 1e9) return "₦" + (n / 1e9).toFixed(2) + " Billion";
  if (n >= 1e6) return "₦" + (n / 1e6).toFixed(2) + " Million";
  return "₦" + n.toLocaleString();
}

function showProgress() {
  console.clear();
  console.log("==================================================");
  console.log("📊 LAGOSLIFE LIVE TRANSFER MONITOR (2nd 1T)");
  console.log("   Target: f3e6cd707d3442bc8374");
  console.log("   Sender: Miles Peter (@milespete)");
  console.log("   Time:  ", new Date().toLocaleTimeString());
  console.log("==================================================\n");

  try {
    if (!fs.existsSync(STATE_FILE)) {
      console.log("⏳ Waiting for pipeline to initialize...");
      return;
    }

    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const remaining = state.remaining ?? 0;
    const sent = TOTAL - remaining;
    const totalTxs = Math.ceil(TOTAL / PER_TX);
    const completedTxs = state.txCount ?? 0;
    const remainingTxs = Math.max(0, totalTxs - completedTxs);
    const percent = Math.min(100, Math.max(0, (sent / TOTAL) * 100));

    const barLength = 28;
    const filledLength = Math.round((barLength * percent) / 100);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

    const etaSeconds = remainingTxs * DELAY_SECS;
    const etaMin = Math.floor(etaSeconds / 60);
    const etaSec = etaSeconds % 60;

    console.log(`Status:        ${remaining === 0 ? "✅ COMPLETED" : "🚀 TRANSFERRING"}`);
    console.log(`Progress:      [${bar}] ${percent.toFixed(1)}%`);
    console.log(`Sent:          ${fmt(sent)} (${completedTxs}/${totalTxs} tx)`);
    console.log(`Remaining:     ${fmt(remaining)}`);
    console.log(`Estimated ETA: ~${etaMin}m ${etaSec}s`);
    console.log("--------------------------------------------------");
    console.log("Press Ctrl+C to exit monitor.");
  } catch (err) {
    console.error("Monitor read error:", err.message);
  }
}

showProgress();
setInterval(showProgress, 3000);
