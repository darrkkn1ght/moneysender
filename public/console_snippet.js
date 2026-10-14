(async function syncLagosLifeStudio() {
  console.log("%c[LagosLife Automation Studio] Extracting game context...", "color:#2563eb; font-weight:bold; font-size:14px;");

  try {
    const cookie = document.cookie;
    const ctx = window.__llCtx || {};
    
    // Fetch live shop data
    let shopData = null;
    try {
      const resp = await fetch("/api/shop");
      if (resp.ok) shopData = await resp.json();
    } catch (e) {}

    // Fetch save state
    let saveData = null;
    try {
      const resp = await fetch("/api/save");
      if (resp.ok) saveData = await resp.json();
    } catch (e) {}

    const payload = {
      cookie: cookie,
      user: ctx.uid || ctx.username || "LagosLife Player",
      context: ctx,
      shops: shopData,
      save: saveData,
      timestamp: Date.now()
    };

    console.log("[LagosLife Studio] Syncing with Local Studio Dashboard (http://localhost:3000)...");

    try {
      await fetch("http://localhost:3000/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {}

    // Auto-load Quilox Club Tapper
    const s = document.createElement("script");
    s.src = "http://localhost:3000/club_tapper.js?t=" + Date.now();
    document.head.appendChild(s);

  } catch (err) {
    console.error("[LagosLife Studio] Error extracting data:", err);
  }
})();
