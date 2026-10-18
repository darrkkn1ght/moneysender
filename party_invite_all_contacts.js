import fs from "node:fs";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMTkxNzM5MDAyfQ.B_AravqWaFLL7xITuYZWd4NqV1qt7oTQkdfm1Wh8GfA";

const STATE_FILE = "./party_invites_state.json";

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { invited: [], count: 0 }; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

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
  console.log("🎉 Collecting all contacts for MilesPete's Party...\n");

  const contactsMap = new Map();

  // 1. Live Inbox Contacts
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
            online: !!t.online
          });
        }
      }
    }
  } catch (e) {
    console.error("Inbox fetch error:", e.message);
  }

  // 2. Saved Contacts
  try {
    const saved = JSON.parse(fs.readFileSync("./all_contacts_combined.json", "utf8"));
    for (const c of saved) {
      if (c.id && c.id !== "bc745837935d45efbf47") {
        if (!contactsMap.has(c.id)) {
          contactsMap.set(c.id, {
            id: c.id,
            username: (c.username || "").replace(/^@/, ""),
            name: c.name || "",
            online: false
          });
        }
      }
    }
  } catch (e) {}

  const allContacts = [...contactsMap.values()];
  
  // Prioritize active/online players first
  allContacts.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

  const onlineCount = allContacts.filter(c => c.online).length;
  console.log(`📋 Total Contacts: ${allContacts.length} (🟢 ${onlineCount} currently online)\n`);

  const state = loadState();
  const invitedSet = new Set(state.invited);

  let successCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < allContacts.length; i++) {
    const contact = allContacts[i];
    const displayUser = contact.username ? `@${contact.username}` : (contact.name || contact.id);
    const statusTag = contact.online ? "🟢 ONLINE" : "⚪ offline";

    if (invitedSet.has(contact.id)) {
      skippedCount++;
      continue;
    }

    console.log(`[${i + 1}/${allContacts.length}] 💌 Inviting ${displayUser} (${contact.name || "Player"}) [${statusTag}] to party...`);

    while (true) {
      const res = await sendPartyInvite(contact.id);

      if (res.status === 200) {
        console.log(`   ✅ House/Party invite sent!`);
        state.invited.push(contact.id);
        state.count = state.invited.length;
        invitedSet.add(contact.id);
        saveState(state);
        successCount++;
        await new Promise(r => setTimeout(r, 4500)); // 4.5s between invites
        break;
      } else if (res.status === 429) {
        const errMsg = res.data?.error || "429";
        console.log(`   ⏳ Cooldown / Rate Limit:`, errMsg);
        if (errMsg.includes("just invited")) {
          state.invited.push(contact.id);
          state.count = state.invited.length;
          invitedSet.add(contact.id);
          saveState(state);
          break;
        }
        // Extract wait minutes if present: "Please wait 14 minutes and try again."
        const match = errMsg.match(/wait\s+(\d+)\s+minute/i);
        if (match) {
          const waitMins = parseInt(match[1], 10);
          console.log(`   ⏸️ Platform-wide cooldown: waiting ${waitMins} minute(s) before resuming...`);
          await new Promise(r => setTimeout(r, (waitMins * 60 + 5) * 1000));
          console.log(`   ▶️ Resuming invites now!`);
          continue; // retry this contact
        }
        await new Promise(r => setTimeout(r, 8000));
        break;
      } else {
        console.log(`   ❌ Status ${res.status}:`, res.data);
        await new Promise(r => setTimeout(r, 3000));
        break;
      }
    }
  }

  console.log(`\n🎊 DONE! Successfully sent ${successCount} party invites (${skippedCount} already had recent invites).`);
}

main().catch(console.error);
