import fs from "node:fs/promises";

async function main() {
  const accounts = JSON.parse(await fs.readFile("./data/accounts.json", "utf8"));
  console.log("=== Current Live Balances ===");
  for (const acc of accounts) {
    try {
      const res = await fetch("https://lagoslife.app/api/save", {
        headers: { "cookie": acc.cookie, "accept": "application/json", "user-agent": "Mozilla/5.0" }
      });
      const data = await res.json().catch(() => ({}));
      const money = data.game?.money ?? data.snap?.cash ?? data.cash ?? 0;
      console.log(`Account: ${acc.name} (${acc.user})`);
      console.log(`  Money: ${(money / 1e12).toFixed(2)} Trillion (₦${money.toLocaleString()})`);
      console.log(`  Status: ${res.status === 200 ? 'ACTIVE' : 'EXPIRED'}`);
    } catch (e) {
      console.error(acc.name, e.message);
    }
  }
}

main();
