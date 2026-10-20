import fs from "node:fs";
import crypto from "node:crypto";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzQxMzgzNTI2fQ.TOb_BRRbfq1sO87BrykoPlSKZJDd0lNnUMIXOUEeUM4";

const AMOUNT_PER_GUEST = 10_000_000_000; // 10B
const DELAY = 25000; // 25s cooldown
const RETRY_DELAY = 5000;
const STATE_FILE = "./balances_party_guests_10b.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { paid: [], totalPaidAmount: 0 }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getLivePlayers() {
  const resp = await fetch("https://lagoslife.app/api/players", {
    headers: {
      "cookie": COOKIE,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "accept": "application/json"
    }
  });
  if (!resp.ok) throw new Error(`Failed to fetch players: ${resp.status}`);
  const data = await resp.json();
  return data.players || [];
}

async function send10B(recipientId) {
  const key = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE,
        "idempotency-key": key,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: recipientId, amount: AMOUNT_PER_GUEST })
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function main() {
  console.log("==================================================");
  console.log("🍸 MILESPETE HOUSE PARTY ONLINE GUESTS AIRDROP");
  console.log("==================================================\n");

  const state = loadState();
  const paidSet = new Set(state.paid);

  // 1. Fetch live players
  const allPlayers = await getLivePlayers();

  // STRICT FILTER: Only ONLINE players!
  const onlineVisitingGuests = allPlayers.filter(p => p.location === "visiting" && p.online === true);

  // Check if manual strangers list exists in guest_usernames.txt
  let manualGuests = [];
  if (fs.existsSync("./guest_usernames.txt")) {
    const raw = fs.readFileSync("./guest_usernames.txt", "utf8");
    const lines = raw.split("\n").map(l => l.trim().replace(/^@/, "")).filter(Boolean);
    for (const nameOrId of lines) {
      const match = allPlayers.find(p => p.username?.toLowerCase() === nameOrId.toLowerCase() || p.id === nameOrId);
      if (match) {
        if (match.online) manualGuests.push(match);
        else console.log(`⏩ [Offline Skipped] ${nameOrId} is not online.`);
      }
    }
  }

  // Combine and deduplicate
  const map = new Map();
  for (const g of [...onlineVisitingGuests, ...manualGuests]) {
    map.set(g.id, g);
  }

  const guestsToPay = [...map.values()];

  console.log(`🎉 Found ${guestsToPay.length} ONLINE guest(s) eligible for 10B:\n`);
  for (let i = 0; i < guestsToPay.length; i++) {
    const g = guestsToPay[i];
    const isPaid = paidSet.has(g.id);
    console.log(`   ${i + 1}. @${g.username || "anon"} (${g.name || "Guest"}) - ID: ${g.id} ${isPaid ? "✅ (ALREADY PAID)" : "⏳ (QUEUED)"}`);
  }
  console.log("");

  const pending = guestsToPay.filter(g => !paidSet.has(g.id));
  console.log(`📢 Pending to send: ${pending.length} online guest(s)\n`);

  for (let i = 0; i < pending.length; i++) {
    const guest = pending[i];
    const tag = guest.username ? `@${guest.username}` : (guest.name || guest.id);

    console.log(`[${i + 1}/${pending.length}] 💸 Sending 10.00B to ${tag} (${guest.id})...`);

    while (true) {
      const res = await send10B(guest.id);

      if (res.status === 200) {
        state.paid.push(guest.id);
        state.totalPaidAmount += AMOUNT_PER_GUEST;
        paidSet.add(guest.id);
        saveState(state);
        console.log(`   ✅ Sent 10B to ${tag}! (${new Date().toLocaleTimeString()})`);
        if (i < pending.length - 1) {
          console.log(`   ⏳ Cooldown: waiting ${DELAY/1000}s for next guest...`);
          await sleep(DELAY);
        }
        break;
      } else if (res.status === 429) {
        console.log(`   ⏳ Rate limited (429), retrying in ${RETRY_DELAY/1000}s...`);
        await sleep(RETRY_DELAY);
      } else if (res.status === 401) {
        console.log(`   🔒 Session expired (401)!`);
        process.exit(1);
      } else {
        console.log(`   ❌ Error ${res.status}:`, res.data);
        await sleep(RETRY_DELAY);
      }
    }
  }

  console.log("\n🎊 DONE! All online guests have been sent 10 Billion each!");
}

main().catch(console.error);
