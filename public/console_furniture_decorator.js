(async function initLagosLifeDecorator() {
  console.log("%c==================================================", "color:#7c3aed; font-weight:bold;");
  console.log("%c🏰 [LagosLife Luxury Room Decorator & Buyer Studio]", "color:#7c3aed; font-weight:bold; font-size:16px;");
  console.log("%c==================================================", "color:#7c3aed; font-weight:bold;");

  const COOKIE = document.cookie;

  // Probe active room / house
  let roomData = null;
  let catalogueData = null;

  try {
    const rResp = await fetch("/api/room");
    if (rResp.ok) roomData = await rResp.json();
  } catch (e) {}

  try {
    const cResp = await fetch("/api/shop");
    if (cResp.ok) catalogueData = await cResp.json();
  } catch (e) {}

  // Extract Next.js state / React state if present
  let nextState = null;
  try {
    if (window.__NEXT_DATA__) {
      nextState = window.__NEXT_DATA__.props;
    }
  } catch (e) {}

  const luxuryCatalog = [
    { id: "f-grandPiano", name: "Grand Piano", category: "Skill/Fun", price: 1500000, emoji: "🎹" },
    { id: "f-helicopter", name: "Helicopter", category: "Luxury/Transport", price: 10000000, emoji: "🚁" },
    { id: "f-yacht", name: "Luxury Yacht", category: "Luxury/Transport", price: 15000000, emoji: "🛥️" },
    { id: "f-jacuzzi", name: "Jacuzzi Spa Tub", category: "Bath", price: 3500000, emoji: "🛁" },
    { id: "f-showerGlass", name: "Shower Glass Box", category: "Bath", price: 1200000, emoji: "🚿" },
    { id: "f-roundBed", name: "Luxury Round Bed", category: "Sleep", price: 2500000, emoji: "🛏️" },
    { id: "f-executiveDesk", name: "Executive Workstation", category: "Skill/Comfort", price: 1800000, emoji: "💻" },
    { id: "f-kitchenIsland", name: "Marble Kitchen Island", category: "Kitchen", price: 2200000, emoji: "🍳" },
    { id: "f-doubleFridge", name: "Stainless Double Fridge", category: "Kitchen", price: 1400000, emoji: "🧊" },
    { id: "f-redSofa", name: "Red Leather Sofa", category: "Comfort", price: 950000, emoji: "🛋️" },
    { id: "f-blackSofa", name: "Black Leather Sofa", category: "Comfort", price: 950000, emoji: "🛋️" },
    { id: "f-tv85", name: "85\" Ultra-HD Smart TV", category: "Fun", price: 2800000, emoji: "📺" },
    { id: "f-poolTable", name: "Billiards / Pool Table", category: "Fun", price: 3200000, emoji: "🎱" },
    { id: "f-redRug", name: "Red Velvet Rug", category: "Design", price: 450000, emoji: "🔴" },
    { id: "f-obaStatue", name: "Golden Oba Statue", category: "Design/Luxury", price: 5000000, emoji: "🏆" }
  ];

  window.LL_Decorator = {
    room: roomData,
    catalogue: catalogueData,
    nextProps: nextState,
    luxuryItems: luxuryCatalog,

    // Buy item method
    async buyItem(itemId, qty = 1) {
      console.log(`[Decorator] Purchasing ${qty}x ${itemId}...`);
      try {
        const resp = await fetch("/api/shop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item: itemId, quantity: qty })
        });
        const res = await resp.json();
        console.log(`[Decorator] Buy Result:`, res);
        return res;
      } catch (err) {
        console.error(`[Decorator] Buy Failed:`, err);
      }
    },

    // Buy all luxury items bundle
    async buyLuxuryBundle() {
      console.log("%c[Decorator] Buying All Luxury Room Items...", "color:#16a34a; font-weight:bold;");
      for (const item of luxuryCatalog) {
        console.log(` -> Buying ${item.emoji} ${item.name} (${item.id})...`);
        await this.buyItem(item.id, 1);
        await new Promise(r => setTimeout(r, 500));
      }
      alert("🎉 Luxury Furniture Bundle Purchase Complete! Check your Storage / Catalogue.");
    },

    // Place item method
    async placeItem(itemId, x, y, rot = 0) {
      console.log(`[Decorator] Placing ${itemId} at (${x}, ${y}) rotation ${rot}...`);
      try {
        const resp = await fetch("/api/room", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "place", item: itemId, x, y, rotation: rot })
        });
        const res = await resp.json();
        console.log(`[Decorator] Place Result:`, res);
        return res;
      } catch (err) {
        console.error(`[Decorator] Place Failed:`, err);
      }
    },

    // Auto Decorate Layout
    async autoDecorate() {
      console.log("%c[Decorator] Auto-Decorating Room Zones...", "color:#2563eb; font-weight:bold;");
      const placements = [
        { id: "f-grandPiano", x: 4, y: 12, rot: 90 },
        { id: "f-helicopter", x: 2, y: 2, rot: 0 },
        { id: "f-yacht", x: 22, y: 2, rot: 0 },
        { id: "f-jacuzzi", x: 18, y: 18, rot: 0 },
        { id: "f-showerGlass", x: 20, y: 20, rot: 0 },
        { id: "f-roundBed", x: 12, y: 4, rot: 180 },
        { id: "f-executiveDesk", x: 16, y: 4, rot: 0 },
        { id: "f-kitchenIsland", x: 20, y: 12, rot: 90 },
        { id: "f-doubleFridge", x: 22, y: 10, rot: 90 },
        { id: "f-redSofa", x: 8, y: 10, rot: 0 },
        { id: "f-blackSofa", x: 8, y: 14, rot: 0 },
        { id: "f-tv85", x: 6, y: 12, rot: 270 },
        { id: "f-poolTable", x: 12, y: 20, rot: 0 },
        { id: "f-redRug", x: 8, y: 12, rot: 0 },
        { id: "f-obaStatue", x: 2, y: 10, rot: 0 }
      ];

      for (const p of placements) {
        console.log(` -> Placing ${p.id} at grid (${p.x}, ${p.y})...`);
        await this.placeItem(p.id, p.x, p.y, p.rot);
        await new Promise(r => setTimeout(r, 400));
      }
      alert("✨ Room Auto-Decorated Successfully!");
    }
  };

  // Post sync payload to Local Dashboard
  try {
    await fetch("http://localhost:3000/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cookie: COOKIE,
        room: roomData,
        catalogue: catalogueData,
        timestamp: Date.now()
      })
    });
  } catch (e) {}

  console.log("%c[Decorator] Studio Suite Loaded!", "color:#16a34a; font-weight:bold;");
  console.log("Commands available in console:");
  console.log("  • LL_Decorator.buyLuxuryBundle()  -> Buy all luxury items seen in your screenshot");
  console.log("  • LL_Decorator.autoDecorate()     -> Automatically arrange room layout");
  console.log("  • LL_Decorator.buyItem(itemId, qty)");
  console.log("  • LL_Decorator.placeItem(itemId, x, y, rot)");

  alert("🏰 LagosLife Luxury Decorator Ready!\nOpen Developer Console (F12) and type:\n\nLL_Decorator.buyLuxuryBundle()\nor\nLL_Decorator.autoDecorate()");
})();
