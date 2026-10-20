import fs from 'node:fs';

async function main() {
  const pageRes = await fetch('https://lagoslife.app/');
  const html = await pageRes.text();
  const manifestMatch = html.match(/src="(\/_next\/static\/[^\"]*\/_buildManifest\.js)"/);
  console.log('Manifest URL:', manifestMatch ? manifestMatch[1] : 'not found');
  if (manifestMatch) {
    const r = await fetch('https://lagoslife.app' + manifestMatch[1]);
    const txt = await r.text();
    console.log(txt);
  }
}

main();
