import fs from "node:fs";

const d = JSON.parse(fs.readFileSync("./scratch_miles_messages.json"));
const incoming = (d.threads || []).filter(t => t.last && !t.last.mine);

console.log(`=== ALL ${incoming.length} INCOMING THREADS TO @MILESPETE ===\n`);

incoming.forEach((t, i) => {
  const preview = (t.last.body || "").replace(/\n/g, " ").slice(0, 140);
  console.log(`[${i + 1}] @${t.username} (${t.name}) [ID: ${t.id} | unread: ${t.unread}]`);
  console.log(`    Message: "${preview}"\n`);
});
