import fs from "node:fs";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMzQxMzgzNTI2fQ.TOb_BRRbfq1sO87BrykoPlSKZJDd0lNnUMIXOUEeUM4";

const STATE_FILE = "./house_party_state.json";
const SLEEP_BETWEEN_INVITES_MS = 4000;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { invited: [], onlineCompleted: false }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendPartyInvite(userId) {
  try {
    const resp = await fetch("https://lagoslife.app/api/invite", {
      method: "POST",
      headers: {
        "cookie": COOKIE,
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ to: userId })
    });
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  } catch (err) {
    return { status: 0, error: err.message || String(err) };
  }
}

async function main() {
  console.log("==================================================");
  console.log("🎉 LAGOSLIFE HOUSE PARTY AUTO-INVITER");
  console.log("==================================================\n");

  const contactsMap = new Map();

  // 1. Fetch live inbox threads to get online status
  console.log("📡 Fetching live players and inbox threads...");
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", { headers: { cookie: COOKIE } });
    if (resp.ok) {
      const data = await resp.json();
      for (const t of (data.threads || [])) {
        if (t.id && t.id !== "bc745837935d45efbf47") {
          contactsMap.set(t.id, {
            id: t.id,
            username: t.username || "",
            name: t.name || "",
            online: !!t.online,
            updatedAt: t.updatedAt || t.at || 0
          });
        }
      }
    }
  } catch (e) {
    console.error("Inbox fetch error:", e.message);
  }

  // 2. Fetch all known contacts from contact list
  try {
    const saved = JSON.parse(fs.readFileSync("./all_contacts_combined.json", "utf8"));
    for (const c of saved) {
      if (c.id && c.id !== "bc745837935d45efbf47") {
        if (!contactsMap.has(c.id)) {
          contactsMap.set(c.id, {
            id: c.id,
            username: (c.username || "").replace(/^@/, ""),
            name: c.name || "",
            online: false,
            updatedAt: 0
          });
        }
      }
    }
  } catch (e) {}

  const allContacts = [...contactsMap.values()];
  const onlinePlayers = allContacts.filter(c => c.online);
  const offlinePlayers = allContacts.filter(c => !c.online);

  console.log(`\n📋 Contacts Summary:`);
  console.log(`   🟢 Online / Active Players:   ${onlinePlayers.length}`);
  console.log(`   ⚪ Inactive / Offline Players: ${offlinePlayers.length}`);
  console.log(`   Total Candidates:            ${allContacts.length}\n`);

  const state = loadState();
  const invitedSet = new Set(state.invited);

  async function inviteList(list, label) {
    console.log(`\n--------------------------------------------------`);
    console.log(`🚀 Starting ${label} Invites (${list.length} players)`);
    console.log(`--------------------------------------------------`);

    let sent = 0;
    let skipped = 0;

    for (let i = 0; i < list.length; i++) {
      const contact = list[i];
      const tag = contact.username ? `@${contact.username}` : (contact.name || contact.id);

      if (invitedSet.has(contact.id)) {
        skipped++;
        continue;
      }

      console.log(`[${label} ${i + 1}/${list.length}] 💌 Inviting ${tag}...`);

      while (true) {
        const res = await sendPartyInvite(contact.id);

        if (res.status === 200) {
          console.log(`   ✅ House party invite sent! (${new Date().toLocaleTimeString()})`);
          state.invited.push(contact.id);
          invitedSet.add(contact.id);
          saveState(state);
          sent++;
          await sleep(SLEEP_BETWEEN_INVITES_MS);
          break;
        } else if (res.status === 429) {
          const errMsg = res.data?.error || "Rate limited";
          console.log(`   ⏳ Cooldown / 429:`, errMsg);

          if (errMsg.includes("just invited") || errMsg.includes("already invited")) {
            state.invited.push(contact.id);
            invitedSet.add(contact.id);
            saveState(state);
            break;
          }

          // Check if server gave a wait time in minutes
          const match = errMsg.match(/wait\s+(\d+)\s+minute/i);
          if (match) {
            const waitMins = parseInt(match[1], 10);
            console.log(`   ⏸️ Platform cooldown: waiting ${waitMins} min...`);
            await sleep((waitMins * 60 + 5) * 1000);
            console.log(`   ▶️ Resuming invites now!`);
            continue;
          }

          await sleep(6000);
          break;
        } else {
          console.log(`   ⚠️ Response status ${res.status}:`, res.data);
          await sleep(2000);
          break;
        }
      }
    }

    console.log(`✨ ${label} Invites Complete: Sent ${sent}, Skipped ${skipped}`);
  }

  // PHASE 1: Active / Online players first
  await inviteList(onlinePlayers, "ACTIVE PLAYERS");
  state.onlineCompleted = true;
  saveState(state);

  // PHASE 2: Inactive / Offline players second
  await inviteList(offlinePlayers, "OFFLINE PLAYERS");

  console.log(`\n🎉🎉 ALL HOUSE PARTY INVITES SENT! Total Unique Invites: ${state.invited.length}`);
}

main().catch(console.error);
