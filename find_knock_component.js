import fs from 'node:fs';

async function scan() {
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  for (const s of scriptMatches) {
    try {
      const r = await fetch('https://lagoslife.app' + s);
      const txt = await r.text();
      // Match setWorld call
      const match = txt.match(/setWorld\(\{/);
      if (match) {
        const idx = match.index;
        console.log(`=== setWorld({ found in ${s} at ${idx} ===`);
        console.log(txt.substring(Math.max(0, idx - 400), Math.min(txt.length, idx + 400)));
      }
      // Also match world endpoint
      if (txt.includes('/api/world') || txt.includes('/api/live') || txt.includes('/api/heartbeat') || txt.includes('/api/state')) {
        console.log(`=== API world/live in ${s} ===`);
        const matches = txt.match(/\/api\/[a-zA-Z0-9_\-\/]+/g) || [];
        console.log([...new Set(matches)].filter(a => /world|live|heartbeat|state|guest|knock|room|save/i.test(a)));
      }
    } catch (e) {
      console.error(s, e.message);
    }
  }
}

scan();
