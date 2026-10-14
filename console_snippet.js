(async function syncLagosLifeStudio() {
  console.log("%c[LagosLife Automation Studio] Extracting game context...", "color:#2563eb; font-weight:bold; font-size:14px;");

  try {
    const cookie = document.cookie;
    const ctx = window.__llCtx || {};
    
    // Fetch live shop data directly from browser session
    let shopData = null;
    try {
      const resp = await fetch("/api/shop");
      if (resp.ok) shopData = await resp.json();
    } catch (e) {}

    // Fetch user message list / favorites
    let recipientsData = [];
    try {
      const resp = await fetch("/api/messages?with=7785cae4f157450490d5");
      if (resp.ok) {
        const msgJson = await resp.json();
        if (msgJson.messages) {
          recipientsData = msgJson.messages.map(m => m.id);
        }
      }
    } catch (e) {}

    const payload = {
      cookie: cookie,
      user: ctx.uid || ctx.username || "LagosLife Player",
      context: ctx,
      shops: shopData,
      timestamp: Date.now()
    };

    console.log("[LagosLife Studio] Sending payload to Local Studio Dashboard (http://localhost:3000)...");

    const syncResp = await fetch("http://localhost:3000/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (syncResp.ok) {
      console.log("%c[LagosLife Studio] SYNC SUCCESSFUL! Account & Shop Catalog updated on Dashboard.", "color:#16a34a; font-weight:bold; font-size:14px;");
      alert("✅ LagosLife Studio Sync Complete! Account & Shop details updated on your dashboard.");
    } else {
      console.error("[LagosLife Studio] Sync failed:", await syncResp.text());
    }

  } catch (err) {
    console.error("[LagosLife Studio] Error extracting data:", err);
  }
})();
