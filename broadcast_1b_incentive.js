import fs from "node:fs";

// Session Cookie for @milespete
const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=a0a199276c31c3ab9e62c542f465532eecbeb7f480adf58fbd8eb8f33c799094; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IjJ4cFplb2VObGZYTEh0VUEiLCJlIjoxNzkyMTE2NTM0MzY2fQ.UJWqc2tFrMVPbXnnolCqfipkguVBoB6SzJPvwJznxsQ";

const CONTACTS_FILE = "./all_contacts_combined.json";
const STATE_FILE = "./state_1b_incentive.json";
const DELAY_MS = 2500;
const RETRY_DELAY_MS = 5000;

function loadContacts() {
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
  } catch (err) {
    console.error("Could not load contacts:", err.message);
    return [];
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { sent: {}, failed: {} };
  }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendMessage(targetId, body) {
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "cookie": COOKIE,
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

async function main() {
  const contacts = loadContacts();
  const state = loadState();

  console.log("=================================================");
  console.log("    BROADCAST: ₦1B REWARD FOR TWITTER SUPPORT    ");
  console.log("=================================================");
  console.log(`Loaded ${contacts.length} total recipients (Inbox + Past Transfer Recipients).`);
  console.log(`Delay: ${DELAY_MS / 1000}s per message\n`);

  let count = 0;

  for (const contact of contacts) {
    const targetId = contact.id;
    const name = contact.name || "friend";
    const username = contact.username || "";

    if (!targetId || targetId === "bc745837935d45efbf47") continue; // Skip self

    if (state.sent[targetId]) {
      console.log(`⏩ [Skipped] Already sent to ${name} (${targetId})`);
      continue;
    }

    const messageBody = `Hey ${name}! Odogwu Miles here. My bank was restricted to ₦10m a day today so I need your help on Twitter to get my account unblocked! I am giving ₦1 BILLION to everyone who helps (sent directly to you from @blaqsebastian)!

Here is how to help:
1. Copy this link: https://x.com/MilesPetes/status/2111176850567282703
2. Open it in Twitter / X
3. Like, Repost, and reply: @Shalom_HeyEliy @LagosLifeApp please unrestrict MilesPete!
4. Reply back to me here with your username once done and receive your 1B! 🙏`;

    count++;
    console.log(`[#${count}] Sending to ${name} (${username || targetId})...`);

    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      attempts++;
      const res = await sendMessage(targetId, messageBody);

      if (res.status === 200) {
        success = true;
        state.sent[targetId] = {
          sentAt: new Date().toISOString(),
          name,
          username,
          msgId: res.data.id || null
        };
        saveState(state);
        console.log(`  ✅ Sent! (ID: ${res.data.id || "ok"})`);
        await sleep(DELAY_MS);
      } else if (res.status === 429) {
        console.log(`  ⏳ Rate limited (429). Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      } else if (res.status === 401) {
        console.error(`  🔒 Session expired! Update COOKIE in script.`);
        process.exit(1);
      } else {
        console.error(`  ❌ Error ${res.status}:`, res.data || res.error);
        state.failed[targetId] = { error: res.data || res.error, at: new Date().toISOString() };
        saveState(state);
        break;
      }
    }
  }

  console.log("\n🎉 Finished broadcasting ₦1B incentive campaign!");
  console.log(`Total messages sent this session: ${count}`);
}

main().catch(console.error);
