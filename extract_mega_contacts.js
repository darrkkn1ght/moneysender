import fs from "node:fs";

const allContacts = new Map();

function addContact(id, name, source) {
  if (!id || typeof id !== "string") return;
  const cleanId = id.trim().toLowerCase();
  if (!/^[0-9a-f]{20}$/.test(cleanId)) return;
  
  // Don't add bot / known own accounts
  if (cleanId === "bc745837935d45efbf47" || cleanId === "7785cae4f157450490d5" || cleanId === "d4f4aed94d6e491989cf") return;

  if (!allContacts.has(cleanId)) {
    allContacts.set(cleanId, {
      id: cleanId,
      name: name && typeof name === "string" ? name.trim() : "Player",
      source
    });
  } else if (name && allContacts.get(cleanId).name === "Player") {
    allContacts.get(cleanId).name = name.trim();
  }
}

// 1. Existing contacts list
try {
  const existing = JSON.parse(fs.readFileSync("./all_contacts_combined.json", "utf8"));
  for (const c of existing) addContact(c.id, c.name, "all_contacts_combined");
} catch {}

// 2. Recipients to message
try {
  const rec = JSON.parse(fs.readFileSync("./recipients_to_message.json", "utf8"));
  for (const r of rec) addContact(r.id, r.name, "recipients_to_message");
} catch {}

// 3. Inbox threads full
try {
  const threads = JSON.parse(fs.readFileSync("./inbox_threads_full.json", "utf8"));
  for (const t of threads) {
    addContact(t.with || t.id, t.name || t.username, "inbox_threads");
    if (Array.isArray(t.messages)) {
      for (const m of t.messages) {
        addContact(m.sender || m.from || m.to, null, "inbox_messages");
      }
    }
  }
} catch {}

// 4. Current incoming messages
try {
  const inc = JSON.parse(fs.readFileSync("./current_incoming_messages.json", "utf8"));
  for (const m of inc) {
    addContact(m.sender || m.from || m.id, m.name, "incoming_messages");
  }
} catch {}

// 5. Whot discovery players
try {
  const whot = JSON.parse(fs.readFileSync("./whot_discovery.json", "utf8"));
  function scanObj(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && /^[0-9a-f]{20}$/i.test(v)) {
        addContact(v, obj.name || obj.username || null, "whot_discovery");
      } else if (typeof v === "object") {
        scanObj(v);
      }
    }
  }
  scanObj(whot);
} catch {}

// 6. Club discovery players
try {
  const club = JSON.parse(fs.readFileSync("./club_discovery.json", "utf8"));
  function scanClub(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && /^[0-9a-f]{20}$/i.test(v)) {
        addContact(v, obj.name || obj.username || null, "club_discovery");
      } else if (typeof v === "object") {
        scanClub(v);
      }
    }
  }
  scanClub(club);
} catch {}

// 7. General discovery results
try {
  const disc = JSON.parse(fs.readFileSync("./discovery_results.json", "utf8"));
  function scanDisc(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && /^[0-9a-f]{20}$/i.test(v)) {
        addContact(v, obj.name || obj.username || null, "discovery_results");
      } else if (typeof v === "object") {
        scanDisc(v);
      }
    }
  }
  scanDisc(disc);
} catch {}

// 8. Extract relationships from mr_who save file
const COOKIE_MRWHO = "ll_dev=0u144y403y0n5o4c; ll_session=30ed25151a51189b01b77ec860906bcf4ff53eef06599f910f94fa3b4f329fba; ll_pass=eyJpIjoiZDRmNGFlZDk0ZDZlNDkxOTg5Y2YiLCJ1IjoibXJfd2hvIiwibiI6Iklka3dldHVsbWEiLCJ0IjoicHdjNFB1U3R0M2ROZ0ZkVCIsImUiOjE3OTIzNzQ0Nzg5NDd9.n3er-Yhh5QKWtVnl12SnIDGNgYt6MHD1P1qv0uuRJng";

async function fetchLive() {
  try {
    const res = await fetch("https://lagoslife.app/api/save", { headers: { cookie: COOKIE_MRWHO } });
    if (res.ok) {
      const data = await res.json();
      if (data.game?.relationships) {
        for (const [id, rel] of Object.entries(data.game.relationships)) {
          addContact(id, rel.name || null, "mrwho_relationships");
        }
      }
    }
  } catch {}

  const outputList = Array.from(allContacts.values());
  fs.writeFileSync("./mega_contacts_list.json", JSON.stringify(outputList, null, 2));
  console.log(`✅ Extracted ${outputList.length} total unique contacts to mega_contacts_list.json!`);
}

fetchLive();
