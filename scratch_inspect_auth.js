async function inspectApp() {
  const res = await fetch("https://lagoslife.app");
  const text = await res.text();
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/g;
  let m;
  const scriptUrls = [];
  while ((m = scriptRegex.exec(text)) !== null) {
    scriptUrls.push(m[1]);
  }
  console.log("Found scripts:", scriptUrls.length);

  for (const s of scriptUrls) {
    const url = s.startsWith("http") ? s : "https://lagoslife.app" + s;
    try {
      const code = await (await fetch(url)).text();
      // search for login, logout, pass, signin, key
      const matches = code.match(/["'](\/api\/[^"']+)["']/g);
      if (matches) {
        const uniqueApis = [...new Set(matches)];
        console.log("APIs in", s.split("/").pop(), ":", uniqueApis.filter(a => a.toLowerCase().includes("log") || a.toLowerCase().includes("auth") || a.toLowerCase().includes("pass") || a.toLowerCase().includes("sign") || a.toLowerCase().includes("save")));
      }
    } catch (e) {
      console.log("Error fetching", s, e.message);
    }
  }
}
inspectApp();
