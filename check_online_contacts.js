import fs from "node:fs/promises";

const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=7905085c7b02a4e840a338dd3484f8995d019cd955fdf7d8f1c2a7ba846d1ee0; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IlJPZXdwcjRWTlVNRE9uLUkiLCJlIjoxNzkyNDA0OTAyODk1fQ.wyQw5T4rXT32ZYfwVpvzddrsOPc4qM50CFHT6W-awrQ";

async function main() {
  const resp = await fetch("https://lagoslife.app/api/messages", { headers: { cookie: COOKIE } });
  if (!resp.ok) {
    console.error("Failed to fetch messages:", resp.status);
    return;
  }
  const data = await resp.json();
  const threads = data.threads || [];
  console.log(`Total threads in MilesPete inbox: ${threads.length}`);

  const online = threads.filter(t => t.online && t.id !== "bc745837935d45efbf47");
  console.log(`🟢 Currently Active / Online Contacts: ${online.length}`);
  for (const o of online) {
    console.log(`- @${o.username} (${o.name || 'No Name'}) [ID: ${o.id}]`);
  }
}

main();
