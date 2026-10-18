import fs from "node:fs";
import path from "node:path";

const allRecipients = new Map();

// 1. From recipients_to_message.json
try {
  const inbox = JSON.parse(fs.readFileSync("./recipients_to_message.json", "utf8"));
  for (const r of inbox) {
    if (r.id) allRecipients.set(r.id, { id: r.id, name: r.name || r.username, username: r.username, source: "inbox" });
  }
} catch (e) {}

// 2. From data/recipients.json
try {
  const rec = JSON.parse(fs.readFileSync("./data/recipients.json", "utf8"));
  for (const r of rec) {
    if (r.id) allRecipients.set(r.id, { id: r.id, name: r.name, source: "dashboard_recipients" });
  }
} catch (e) {}

// 3. From all balances_*.json
const files = fs.readdirSync(".");
for (const f of files) {
  if (f.startsWith("balances_") && f.endsWith(".json")) {
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const [k, v] of Object.entries(data)) {
        if (/^[0-9a-f]{20}$/i.test(k)) {
          if (!allRecipients.has(k)) {
            allRecipients.set(k, { id: k, name: `Transfer Recipient (${k.substring(0,6)})`, source: f });
          }
        }
      }
      if (data.target && /^[0-9a-f]{20}$/i.test(data.target)) {
        if (!allRecipients.has(data.target)) {
          allRecipients.set(data.target, { id: data.target, name: `Target (${data.target.substring(0,6)})`, source: f });
        }
      }
    } catch (e) {}
  }
  
  // 4. From pipeline_*.js TARGET constants
  if (f.startsWith("pipeline_") && f.endsWith(".js")) {
    try {
      const content = fs.readFileSync(f, "utf8");
      const match = content.match(/const TARGET = ["']([0-9a-f]{20})["']/i);
      if (match && match[1]) {
        const id = match[1];
        if (!allRecipients.has(id)) {
          allRecipients.set(id, { id, name: `Pipeline Target (${id.substring(0,6)})`, source: f });
        }
      }
    } catch (e) {}
  }
}

console.log("Total unique recipients found:", allRecipients.size);
const list = [...allRecipients.values()];
fs.writeFileSync("./all_contacts_combined.json", JSON.stringify(list, null, 2));
console.log("Saved to ./all_contacts_combined.json");
