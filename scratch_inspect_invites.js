import fs from 'node:fs';

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyMTkxNzM5MDAyfQ.B_AravqWaFLL7xITuYZWd4NqV1qt7oTQkdfm1Wh8GfA";

async function main() {
  const contactsMap = new Map();

  // 1. From inbox threads (MilesPete's direct contact list)
  const resp = await fetch("https://lagoslife.app/api/messages", { headers: { cookie: COOKIE } });
  if (resp.ok) {
    const data = await resp.json();
    for (const t of (data.threads || [])) {
      if (t.id && t.id !== "bc745837935d45efbf47") { // don't invite himself
        contactsMap.set(t.id, {
          id: t.id,
          username: t.username,
          name: t.name,
          online: !!t.online,
          source: "inbox"
        });
      }
    }
  }

  // 2. From all_contacts_combined.json
  try {
    const saved = JSON.parse(fs.readFileSync('./all_contacts_combined.json', 'utf8'));
    for (const c of saved) {
      if (c.id && c.id !== "bc745837935d45efbf47") {
        if (!contactsMap.has(c.id)) {
          contactsMap.set(c.id, {
            id: c.id,
            username: (c.username || '').replace(/^@/, ''),
            name: c.name,
            online: false,
            source: "saved_contacts"
          });
        }
      }
    }
  } catch (e) {}

  console.log(`Total unique contacts in contact list: ${contactsMap.size}`);
  const online = [...contactsMap.values()].filter(c => c.online);
  console.log(`Currently Online: ${online.length}`);
}

main();
