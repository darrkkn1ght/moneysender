import fs from 'node:fs';

async function main() {
  const r = await fetch('https://lagoslife.app/_next/static/chunks/3z0xxwyie_394.js');
  const txt = await r.text();
  console.log(txt.substring(12600, 15400));
}

main();
