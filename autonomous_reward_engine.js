import fs from "node:fs";
import crypto from "node:crypto";

// Sessions
const COOKIE_MILES = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=a0a199276c31c3ab9e62c542f465532eecbeb7f480adf58fbd8eb8f33c799094; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IjJ4cFplb2VObGZYTEh0VUEiLCJlIjoxNzkyMTE2NTM0MzY2fQ.UJWqc2tFrMVPbXnnolCqfipkguVBoB6SzJPvwJznxsQ";
const COOKIE_BLAQ = "ll_dev=4o3z111w5i470l2f; ll_vid=2fe99f9ce0624c4abb14; ll_session=c0a17f10cf24947e9b87549591023ffaf52ecc947a5963da92c6fe5d95abda86; ll_pass=eyJpIjoiNzc4NWNhZTRmMTU3NDUwNDkwZDUiLCJ1IjoiYmxhcXNlYmFzdGlhbiIsIm4iOiJTZWJhc3RpYW4iLCJ0IjoiazBIdUtRd3pKV2w1M0pSNiIsImUiOjE3OTE5NzU4MDkzNTl9.BAmUvRXuwNmzwWQAdeVQLDrfJ_k0-6_zfPy_Qc-GMXw";

const REWARD_AMOUNT = 1_000_000_000; // 1 Billion
const HISTORY_FILE = "./automated_rewards_history.json";
const HELP_LOG_FILE = "./automated_help_history.json";
const POLL_INTERVAL_MS = 12000;
const TX_DELAY_MS = 25000; // 25s between transfers from Blaq for safety

function loadJson(file, defaultVal) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return defaultVal; }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Send transfer from Blaq
async function sendTransferFromBlaq(targetId) {
  const key = crypto.randomUUID();
  try {
    const resp = await fetch("https://lagoslife.app/api/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE_BLAQ,
        "idempotency-key": key,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, amount: REWARD_AMOUNT })
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

// Send chat message from Miles
async function sendMilesMessage(targetId, body) {
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE_MILES,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: targetId, body })
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

// Keywords confirming they helped on Twitter
const CONFIRM_KEYWORDS = [
  "done", "i did it", "retweeted", "reposted", "replied", "tweeted", 
  "helped", "checked", "sent", "liked", "tagged", "voted", 
  "finished", "already", "i have done", "check it", "check twitter",
  "dona", "doen"
];

// Keywords asking how to help
const HELP_KEYWORDS = [
  "how", "what", "link", "understand", "explain", "where", "how do", "guide"
];

function checkKeywords(text, list) {
  const lower = (text || "").toLowerCase();
  return list.some(k => lower.includes(k));
}

let payoutQueue = [];
let isProcessingQueue = false;

async function processPayoutQueue() {
  if (isProcessingQueue || payoutQueue.length === 0) return;
  isProcessingQueue = true;

  while (payoutQueue.length > 0) {
    const item = payoutQueue.shift();
    const { targetId, name, username, lastMsg } = item;
    const history = loadJson(HISTORY_FILE, {});

    if (history[targetId]) {
      console.log(`⏩ [Queue] ${name} (${targetId}) already received reward. Skipping.`);
      continue;
    }

    console.log(`\n💰 [PAYOUT] Sending ₦1B from @blaqsebastian to ${name} (${username || targetId})...`);
    const txRes = await sendTransferFromBlaq(targetId);

    if (txRes.status === 200) {
      console.log(`  ✅ Transfer of ₦1B confirmed!`);
      history[targetId] = {
        name,
        username,
        paidAt: new Date().toISOString(),
        amount: REWARD_AMOUNT,
        triggerMsg: lastMsg
      };
      saveJson(HISTORY_FILE, history);

      // Send confirmation DM
      const confirmText = `🎉 Received! Thank you for supporting me on Twitter! I just sent you ₦1,000,000,000 (1B) from @blaqsebastian 💸 Check your balance right now! Please keep helping me repost and push the team to unrestrict MilesPete! 🙏`;
      await sendMilesMessage(targetId, confirmText);
      console.log(`  ✉️ Confirmation message sent from @milespete.`);

      console.log(`  ⏳ Throttling ${TX_DELAY_MS / 1000}s for next transfer...`);
      await sleep(TX_DELAY_MS);
    } else if (txRes.status === 429) {
      console.log(`  ⏳ 429 Transfer rate limit, re-queuing ${name}...`);
      payoutQueue.unshift(item);
      await sleep(10000);
    } else {
      console.error(`  ❌ Payout failed (${txRes.status}):`, txRes.data || txRes.error);
    }
  }

  isProcessingQueue = false;
}

async function scanInbox() {
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", {
      headers: { cookie: COOKIE_MILES, accept: "application/json" }
    });
    if (!resp.ok) return;

    const data = await resp.json();
    const threads = data.threads || [];
    const history = loadJson(HISTORY_FILE, {});
    const helpHistory = loadJson(HELP_LOG_FILE, {});

    for (const thread of threads) {
      const targetId = thread.id;
      if (!targetId || targetId === "bc745837935d45efbf47") continue;

      const last = thread.last;
      if (!last || last.mine) continue; // Only process incoming messages from the player

      const text = last.body || "";
      const name = thread.name || thread.username || "Friend";
      const username = thread.username ? `@${thread.username}` : "";

      // 1. Did they say they helped / done?
      if (checkKeywords(text, CONFIRM_KEYWORDS) && !history[targetId]) {
        // Enqueue if not already in queue
        if (!payoutQueue.some(q => q.targetId === targetId)) {
          console.log(`🎯 [Incoming Support Match] ${name} (${username}): "${text}"`);
          console.log(`   -> Queuing ₦1B Payout!`);
          payoutQueue.push({ targetId, name, username, lastMsg: text });
          processPayoutQueue().catch(console.error);
        }
      }
      // 2. Are they asking how to do it?
      else if (checkKeywords(text, HELP_KEYWORDS) && !helpHistory[targetId] && !history[targetId]) {
        console.log(`❓ [Incoming Question] ${name} (${username}): "${text}"`);
        const helpText = `Here is how to get your ₦1B:
1. Copy this link: https://x.com/MilesPetes/status/2111176850567282703
2. Open it in Twitter/X
3. Like, Repost, and reply: @Shalom_HeyEliy @LagosLifeApp please unrestrict MilesPete!
4. Reply back here with 'Done' and receive your 1B from @blaqsebastian! 🙏`;

        await sendMilesMessage(targetId, helpText);
        helpHistory[targetId] = { at: new Date().toISOString(), query: text };
        saveJson(HELP_LOG_FILE, helpHistory);
        console.log(`   -> Sent automated step-by-step instructions.`);
        await sleep(2000);
      }
    }
  } catch (err) {
    console.error("Inbox scan error:", err.message);
  }
}

async function runEngine() {
  console.log("=================================================");
  console.log("    AUTONOMOUS ₦1B REWARD & INBOX ENGINE RUNNING ");
  console.log("=================================================");
  console.log("• Watching @milespete inbox for Twitter supporters");
  console.log("• Auto-paying ₦1B from @blaqsebastian to everyone who helped");
  console.log("• Auto-guiding anyone asking how to do it");
  console.log("• Rate safety: 25s throttle between transfers\n");

  while (true) {
    await scanInbox();
    await sleep(POLL_INTERVAL_MS);
  }
}

runEngine().catch(console.error);
