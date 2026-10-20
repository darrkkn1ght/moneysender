import fs from 'node:fs';

async function main() {
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  for (const s of scriptMatches) {
    try {
      const r = await fetch('https://lagoslife.app' + s);
      const txt = await r.text();
      let idx = 0;
      while ((idx = txt.indexOf('.world(', idx)) !== -1) {
        console.log(`\n=== .world( at ${idx} in ${s} ===`);
        console.log(txt.substring(Math.max(0, idx - 150), Math.min(txt.length, idx + 400)));
        idx += 7;
      }
    } catch (e) {
      console.error(s, e.message);
    }
  }
}

main();
