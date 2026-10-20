import fs from "node:fs";

const targets = [
  "Big_stephani",
  "tasticeofx",
  "Kaizen_77",
  "Maryjoydaniel",
  "Xorx_eko",
  "Andreanoe",
  "faeesal",
  "Engr_kenny"
];

function clean(str) {
  return (str || "").toLowerCase().replace(/^@/, "").trim();
}

const files = [
  "./mega_contacts_list.json",
  "./all_contacts_combined.json",
  "./inbox_threads_full.json"
];

const found = {};

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(data) ? data : (data.threads || Object.values(data));
    for (const item of list) {
      if (!item) continue;
      const id = item.id || item.uid || item.with;
      const name = item.name || "";
      const username = item.username || "";

      for (const t of targets) {
        const ct = clean(t);
        if (clean(name) === ct || clean(username) === ct) {
          if (!found[t]) {
            found[t] = { id, name, username, source: file };
          }
        }
      }
    }
  } catch (e) {
    console.error("Error reading", file, e.message);
  }
}

console.log("Resolution results:");
for (const t of targets) {
  console.log(t, "=>", found[t] ? `${found[t].id} (${found[t].name || found[t].username})` : "NOT FOUND in local files");
}
