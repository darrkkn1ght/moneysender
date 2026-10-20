import fs from 'node:fs';

async function main() {
  const r = await fetch('https://lagoslife.app/_next/static/chunks/3z0xxwyie_394.js');
  const txt = await r.text();
  let idx = 0;
  while ((idx = txt.indexOf('/api/world', idx)) !== -1) {
    console.log(`\n=== /api/world at ${idx} ===`);
    console.log(txt.substring(Math.max(0, idx - 150), Math.min(txt.length, idx + 400)));
    idx += 10;
  }
}

main();
