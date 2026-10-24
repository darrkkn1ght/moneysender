import fs from "node:fs";

const ACCOUNTS_FILE = "./data/accounts.json";

function parseAmount(text) {
  if (!text) return null;
  const clean = text.toLowerCase();

  // Explicit Trillion
  const tMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:t|trillion)\b/);
  if (tMatch) return Math.round(parseFloat(tMatch[1]) * 1e12);

  // Explicit Billion
  const bMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:b|billion)\b/);
  if (bMatch) return Math.round(parseFloat(bMatch[1]) * 1e9);

  // Explicit Million
  const mMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:m|million)\b/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1e6);

  // Explicit Thousand (k)
  const kMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1e3);

  // Plain number like 10,000,000,000
  const plainMatch = clean.match(/₦?\s*([\d,]{4,})/);
  if (plainMatch) {
    const val = parseInt(plainMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  return null;
}

async function main() {
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  const miles = accounts.find(a => a.user === "milespete");

  console.log("📥 Fetching latest messages for @milespete...");
  const res = await fetch("https://lagoslife.app/api/messages", {
    headers: { cookie: miles.cookie, accept: "application/json" }
  });
  const data = await res.json();
  const threads = data.threads || [];
  console.log(`✅ Loaded ${threads.length} conversation threads.\n`);

  const beggingKeywords = [
    "money", "cash", "fund", "funds", "help", "urgent", "loan", "borrow", "give", "dash", 
    "send", "broke", "need", "bills", "please", "pls", "plz", "beg", "bless", "stuck", 
    "naira", "transfer", "assist", "spare", "kindness", "favor", "favour", "gift", "starve", "hungry"
  ];

  const candidateBeggars = [];

  for (const t of threads) {
    if (!t.last || t.last.mine) continue;
    const body = (t.last.body || "").trim();
    const lower = body.toLowerCase();

    // Ignore party / event broadcasts unless they explicitly ask for money/funding
    const isBroadcast = (lower.includes("event code") || (lower.includes("party") && lower.includes("invite"))) && 
                        !lower.includes("need money") && !lower.includes("send me") && !lower.includes("help me");
    if (isBroadcast) continue;

    // Check if contains begging/money intent
    const hasBeggingWord = beggingKeywords.some(w => {
      const regex = new RegExp(`\\b${w}\\b`, "i");
      return regex.test(lower);
    });

    const parsed = parseAmount(body);

    if (hasBeggingWord || parsed !== null) {
      // Determine final amount: requested or 10B default if no specific amount mentioned
      // Default: 10,000,000,000 (10B)
      const finalAmount = parsed ? parsed : 10_000_000_000;

      candidateBeggars.push({
        id: t.id,
        username: t.username || "unknown",
        name: t.name || t.username,
        lastMessage: body,
        detectedAmount: parsed,
        finalAmount: finalAmount,
        at: new Date(t.at).toLocaleString(),
        unread: t.unread
      });
    }
  }

  fs.writeFileSync("./detected_beggars.json", JSON.stringify(candidateBeggars, null, 2));

  console.log(`🎯 Found ${candidateBeggars.length} players asking/begging for funds:\n`);
  for (let i = 0; i < candidateBeggars.length; i++) {
    const b = candidateBeggars[i];
    const amtStr = b.detectedAmount 
      ? `₦${(b.detectedAmount >= 1e9 ? (b.detectedAmount/1e9).toFixed(1) + 'B' : b.detectedAmount.toLocaleString())} (Requested)`
      : `₦10.0B (Default)`;
    console.log(`[${i+1}] @${b.username} (${b.name}) | Send: ${amtStr}`);
    console.log(`    Message: "${b.lastMessage.replace(/\n/g, ' ')}"`);
    console.log(`    ID: ${b.id} | Unread: ${b.unread} | At: ${b.at}\n`);
  }
}

main().catch(console.error);
