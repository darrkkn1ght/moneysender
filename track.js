import fs from "node:fs/promises";

async function showProgress() {
  console.clear();
  console.log("==================================================");
  console.log("📊 LAGOSLIFE LIVE TRANSFER MONITOR");
  console.log("   Time:", new Date().toLocaleTimeString());
  console.log("==================================================\n");

  try {
    const res = await fetch("http://localhost:3000/api/transfers/live");
    const data = await res.json();

    data.pipelines.forEach((p, idx) => {
      const sentNum = Number(BigInt(p.sent)) / 1e12;
      const remNum = Number(BigInt(p.remaining)) / 1e12;
      const barLength = 25;
      const filledLength = Math.round((barLength * p.percent) / 100);
      const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);

      console.log(`[${idx + 1}] ${p.name}`);
      console.log(`    Status:        ${p.status === "COMPLETED" ? "✅ COMPLETED" : "🚀 STREAMING"}`);
      console.log(`    Progress:      [${bar}] ${p.percent}%`);
      console.log(`    Sent:          ₦${sentNum.toFixed(2)} Trillion (${p.transactions}/${p.totalTransactions} tx)`);
      console.log(`    Remaining:     ₦${remNum.toFixed(2)} Trillion`);
      console.log("");
    });
  } catch (e) {
    console.error("Dashboard error:", e.message);
  }

  console.log("Dashboard Web UI active on http://localhost:3000");
  console.log("Press Ctrl+C to exit monitor.");
}

showProgress();
setInterval(showProgress, 3000);
