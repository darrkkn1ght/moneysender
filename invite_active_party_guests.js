import fs from "node:fs";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

const STATE_FILE = "./party_invites_active_only_state.json";
const LOG_FILE = "./party_invites_active_only.log";
const SLEEP_MS = 4000;

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { invited: [] }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

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
  log("==================================================");
  log("🎉 MILESPETE EXCLUSIVE: INVITING ACTIVE/ONLINE PLAYERS ONLY");
  log("==================================================");

  // Fetch live inbox threads to extract strictly online players
  let onlinePlayers = [];
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", { headers: { cookie: COOKIE } });
    if (resp.ok) {
      const data = await resp.json();
      for (const t of (data.threads || [])) {
        if (t.id && t.id !== "bc745837935d45efbf47" && t.online) {
          onlinePlayers.push({
            id: t.id,
            username: t.username || "",
            name: t.name || ""
          });
        }
      }
    }
  } catch (e) {
    log("Error querying live messages: " + e.message);
  }

  log(`🟢 Found ${onlinePlayers.length} Active / Online Players right now.`);

  const state = loadState();
  const invitedSet = new Set(state.invited);

  let successCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < onlinePlayers.length; i++) {
    const player = onlinePlayers[i];
    const label = player.username ? `@${player.username}` : (player.name || player.id);

    if (invitedSet.has(player.id)) {
      log(`[${i + 1}/${onlinePlayers.length}] ⏭️ Already invited ${label}, skipping.`);
      skippedCount++;
      continue;
    }

    log(`[${i + 1}/${onlinePlayers.length}] 💌 Inviting ${label}...`);

    while (true) {
      const res = await sendPartyInvite(player.id);

      if (res.status === 200) {
        log(`   ✅ House party invite sent to ${label}!`);
        state.invited.push(player.id);
        invitedSet.add(player.id);
        saveState(state);
        successCount++;
        await sleep(SLEEP_MS);
        break;
      } else if (res.status === 429) {
        const errMsg = res.data?.error || "Rate limited";
        log(`   ⏳ Cooldown (429): ${errMsg}`);

        if (errMsg.includes("just invited") || errMsg.includes("already invited")) {
          state.invited.push(player.id);
          invitedSet.add(player.id);
          saveState(state);
          break;
        }

        const match = errMsg.match(/wait\s+(\d+)\s+minute/i);
        if (match) {
          const waitMins = parseInt(match[1], 10);
          const waitMs = (waitMins * 60 + 5) * 1000;
          log(`   ⏳ Waiting ${waitMins} minute(s) before retry...`);
          await sleep(waitMs);
        } else {
          await sleep(10000);
        }
      } else {
        const errMsg = res.data?.error || JSON.stringify(res.data || res.error);
        log(`   ⚠️ Invite response ${res.status}: ${errMsg}`);
        state.invited.push(player.id);
        invitedSet.add(player.id);
        saveState(state);
        break;
      }
    }
  }

  log(`\n🎉 Completed active invites! Sent: ${successCount} | Skipped: ${skippedCount} | Total online: ${onlinePlayers.length}`);
}

main().catch(err => {
  log("Fatal error: " + err);
  process.exit(1);
});
