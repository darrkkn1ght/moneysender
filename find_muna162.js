import fs from "node:fs/promises";

async function main() {
  const accounts = JSON.parse(await fs.readFile("./data/accounts.json", "utf8"));
  const prince = accounts.find(a => a.user === "princedavid");
  const cookie = prince ? prince.cookie : "";

  const query = "MUNA162";
  try {
    const res = await fetch(`https://lagoslife.app/api/players?q=${encodeURIComponent(query)}`, {
      headers: { cookie, accept: "application/json", "user-agent": "Mozilla/5.0" }
    });
    const data = await res.json();
    console.log("Lookup result for MUNA162:", JSON.stringify(data));
  } catch (e) {
    console.error("Lookup error:", e.message);
  }
}

main();
