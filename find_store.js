import fs from 'node:fs';

async function main() {
  const r = await fetch('https://lagoslife.app/_next/static/chunks/08gv52kuxv4av.js');
  const txt = await r.text();
  console.log(txt.substring(32500, 34500));
}

main();
