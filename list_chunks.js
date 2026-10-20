import fs from 'node:fs';

async function main() {
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const scriptMatches = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map(m => m[1]);
  console.log('Total chunks:', scriptMatches.length);
  console.log(scriptMatches);
}

main();
