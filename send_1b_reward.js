import crypto from "node:crypto";
import fs from "node:fs";

// Session Cookie for @blaqsebastian
const COOKIE = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTE5NzU4MDkzNTl9.BAmUvRXuwNmzwWQAdeVQLDrfJ_k0-6_zfPy_Qc-GMXw";

const REWARD_AMOUNT = 1_000_000_000; // ₦1 Billion
const LOG_FILE = "./sent_1b_rewards.json";

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); }
  catch { return []; }
}

function saveLog(l) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(l, null, 2));
}

// Resolver map for common usernames
const USERNAME_MAP = {
  "blaqsebastian": "7785cae4f157450490d5",
  "milespete": "bc745837935d45efbf47",
  "princedavid": "7e791760cd644f13ba5a"
};

function resolveTarget(input) {
  if (!input) return null;
  const clean = input.trim().toLowerCase().replace(/^@/, "");
  return USERNAME_MAP[clean] || input.trim();
}

async function sendReward(target) {
  const targetId = resolveTarget(target);
  if (!targetId) {
    console.error("Please specify a target user ID or username! Example: node send_1b_reward.js <user_id>");
    process.exit(1);
  }

  const key = crypto.randomUUID();
  console.log(`💸 Sending ₦1,000,000,000 (1B) from @blaqsebastian to ${targetId}...`);

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
      body: JSON.stringify({ to: targetId, amount: REWARD_AMOUNT })
    });

    const data = await resp.json().catch(() => ({}));
    if (resp.status === 200) {
      console.log(`✅ SUCCESS! Sent ₦1B to ${targetId}!`);
      const log = loadLog();
      log.push({ target: targetId, amount: REWARD_AMOUNT, sentAt: new Date().toISOString(), key });
      saveLog(log);
    } else {
      console.error(`❌ Transfer failed (${resp.status}):`, data);
    }
  } catch (err) {
    console.error("Network error sending reward:", err.message);
  }
}

const targetArg = process.argv[2];
if (!targetArg) {
  console.log("Usage: node send_1b_reward.js <username_or_user_id>");
} else {
  sendReward(targetArg);
}
