import fs from "node:fs";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMTkxNzM5MDAyfQ.B_AravqWaFLL7xITuYZWd4NqV1qt7oTQkdfm1Wh8GfA";

const HISTORY_FILE = "./invited_girls_history.json";

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); }
  catch { return []; }
}

function saveHistory(h) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

async function invite(userId) {
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
  console.log("🏠 Gathering active female players to invite to MilesPete's house...\n");

  const candidatesMap = new Map();

  // 1. Fetch live inbox threads
  try {
    const msgResp = await fetch("https://lagoslife.app/api/messages", { headers: { cookie: COOKIE } });
    if (msgResp.ok) {
      const msgData = await msgResp.json();
      for (const t of (msgData.threads || [])) {
        if (!t.id) continue;
        const isFemale = t.look?.body === 'f';
        if (isFemale) {
          candidatesMap.set(t.id, {
            id: t.id,
            username: t.username,
            name: t.name,
            online: !!t.online,
            source: "inbox",
            look: t.look
          });
        }
      }
    }
  } catch (e) {
    console.error("Error fetching messages:", e.message);
  }

  // 2. Fetch live /api/players
  try {
    const pResp = await fetch("https://lagoslife.app/api/players", { headers: { cookie: COOKIE } });
    if (pResp.ok) {
      const pData = await pResp.json();
      for (const p of (pData.players || [])) {
        if (!p.id) continue;
        const isFemale = p.look?.body === 'f';
        if (isFemale) {
          const existing = candidatesMap.get(p.id) || {};
          candidatesMap.set(p.id, {
            id: p.id,
            username: p.username || existing.username,
            name: p.name || existing.name,
            online: existing.online !== undefined ? existing.online : true, // players list is active
            source: existing.source || "players_directory",
            look: p.look
          });
        }
      }
    }
  } catch (e) {
    console.error("Error fetching players:", e.message);
  }

  const allCandidates = [...candidatesMap.values()];
  
  // Sort online first!
  allCandidates.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

  console.log(`Found ${allCandidates.length} female players (${allCandidates.filter(c => c.online).length} currently online).\n`);

  const history = loadHistory();
  const historySet = new Set(history.map(h => h.id));

  let invitedCount = 0;

  for (const player of allCandidates) {
    if (historySet.has(player.id)) {
      console.log(`⏩ [Skipped] @${player.username || player.name} (already invited)`);
      continue;
    }

    const onlineTag = player.online ? "🟢 ONLINE" : "⚪ offline";
    console.log(`💌 Inviting @${player.username || player.name} (${player.name || "Anon"}) [${onlineTag}]...`);

    const res = await invite(player.id);

    if (res.status === 200) {
      console.log(`   ✅ Successfully invited to MilesPete's house!`);
      history.push({ id: player.id, username: player.username, name: player.name, at: Date.now() });
      historySet.add(player.id);
      saveHistory(history);
      invitedCount++;
      await new Promise(r => setTimeout(r, 3500)); // 3.5s delay
    } else if (res.status === 429) {
      console.log(`   ⏳ Rate limit/Recent invite message:`, res.data?.error || "429");
      // If error says "You just invited them", add to history so we don't re-attempt
      if (res.data?.error?.includes("just invited")) {
        history.push({ id: player.id, username: player.username, name: player.name, at: Date.now() });
        historySet.add(player.id);
        saveHistory(history);
      }
      await new Promise(r => setTimeout(r, 4000));
    } else {
      console.log(`   ❌ Status ${res.status}:`, res.data);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n🎉 Finished sending house invitations! Total new invites sent: ${invitedCount}`);
}

main().catch(console.error);
