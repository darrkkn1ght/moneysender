import fs from 'node:fs/promises';

async function main() {
  const accounts = JSON.parse(await fs.readFile('./data/accounts.json', 'utf8'));
  for (const acc of accounts) {
    try {
      const res = await fetch("https://lagoslife.app/api/messages", {
        headers: { cookie: acc.cookie, accept: "application/json", "user-agent": "Mozilla/5.0" }
      });
      const data = await res.json();
      console.log(`\n=== Recent Messages for ${acc.name} ===`);
      for (const t of (data.threads || []).slice(0, 15)) {
        console.log(`User: @${t.username} (${t.name}) [ID: ${t.id}] - Last: "${t.lastMessage || t.body || ''}"`);
      }
    } catch (e) {
      console.error(acc.name, e.message);
    }
  }
}

main();
