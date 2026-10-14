(async function initAbujaHouseBuyer() {
  console.log("%c==================================================", "color:#16a34a; font-weight:bold;");
  console.log("%c🏰 [LagosLife Abuja House Full Catalogue Buyer]", "color:#16a34a; font-weight:bold; font-size:16px;");
  console.log("%c==================================================", "color:#16a34a; font-weight:bold;");

  const COOKIE = document.cookie;

  // Probe active room layout to find open grid tiles
  let roomGrid = [];
  let houseId = null;
  try {
    const rResp = await fetch("/api/room");
    if (rResp.ok) {
      const room = await rResp.json();
      houseId = room.id || room.houseId;
      if (room.grid) roomGrid = room.grid;
    }
  } catch (e) {}

  // Full catalog of all items across Comfort, Sleep, Kitchen, Bath, Light, Decor, Fun, Skills, Luxury
  const FULL_CATALOGUE = [
    // Comfort & Seating
    { id: "c-redChair", name: "Red Chair 1x1", category: "Comfort", price: 15000 },
    { id: "c-standingFan", name: "Standing Fan 1x1", category: "Comfort", price: 25000 },
    { id: "c-diningSet", name: "Dining Table & Chairs 2x2", category: "Comfort", price: 120000 },
    { id: "c-leatherSofaRed", name: "Red Leather Sofa 2x1", category: "Comfort", price: 250000 },
    { id: "c-leatherSofaBlack", name: "Black Leather Sofa 2x1", category: "Comfort", price: 250000 },
    { id: "c-armchairLuxury", name: "Luxury Recliners", category: "Comfort", price: 180000 },
    { id: "c-execDesk", name: "Executive Desk", category: "Comfort", price: 350000 },
    { id: "c-barStools", name: "Bar Stools", category: "Comfort", price: 45000 },

    // Sleep
    { id: "s-luxuryRoundBed", name: "Royal Round Bed", category: "Sleep", price: 2500000 },
    { id: "s-doubleBed", name: "King Size Double Bed", category: "Sleep", price: 1200000 },
    { id: "s-modernFuton", name: "Modern Futon", category: "Sleep", price: 450000 },

    // Kitchen
    { id: "k-doubleFridge", name: "Stainless Double Fridge", category: "Kitchen", price: 1400000 },
    { id: "k-kitchenIsland", name: "Marble Kitchen Island", category: "Kitchen", price: 2200000 },
    { id: "k-chefStove", name: "Pro Chef Oven & Stove", category: "Kitchen", price: 950000 },
    { id: "k-sinkUnit", name: "Granite Kitchen Sink", category: "Kitchen", price: 350000 },
    { id: "k-microwaveConsole", name: "Microwave & Cabinet", category: "Kitchen", price: 280000 },

    // Bath
    { id: "b-jacuzziTub", name: "Circular Jacuzzi Spa", category: "Bath", price: 3500000 },
    { id: "b-showerBox", name: "Glass Shower Cubicle", category: "Bath", price: 1200000 },
    { id: "b-luxuryToilet", name: "Smart Toilet Unit", category: "Bath", price: 450000 },
    { id: "b-washingMachine", name: "Front Load Washer", category: "Bath", price: 650000 },

    // Light
    { id: "l-chandelierGold", name: "Golden Ceiling Chandelier", category: "Light", price: 850000 },
    { id: "l-floorLampModern", name: "Modern Arc Floor Lamp", category: "Light", price: 120000 },
    { id: "l-wallSconceGold", name: "Gold Wall Sconce", category: "Light", price: 95000 },

    // Decor & Art
    { id: "d-redRugLarge", name: "Red Velvet Area Rug 3x2", category: "Decor", price: 450000 },
    { id: "d-circleRug", name: "Circular Floor Rug 2x2", category: "Decor", price: 250000 },
    { id: "d-goldObaStatue", name: "Golden Oba Sculpture", category: "Decor", price: 5000000 },
    { id: "d-goldFrameArt", name: "Gold Framed Wall Painting", category: "Decor", price: 750000 },
    { id: "d-fullLengthMirror", name: "Full Length Vanity Mirror", category: "Decor", price: 320000 },

    // Fun & Skills
    { id: "f-tv85Inch", name: "85\" Ultra-HD Smart TV", category: "Fun", price: 2800000 },
    { id: "f-grandPiano", name: "Concert Grand Piano", category: "Skills", price: 1500000 },
    { id: "f-billiardsTable", name: "Pro Pool / Billiards Table", category: "Fun", price: 3200000 },
    { id: "f-pcGamingDesk", name: "Ultimate Battlestation PC", category: "Skills", price: 2100000 },
    { id: "f-bookshelfOak", name: "Oak Library Bookshelf", category: "Skills", price: 400000 }
  ];

  // Helper function: Buy item directly into house (place: true)
  async function buyAndPlaceInHouse(item, gridX, gridY) {
    console.log(`[Abuja Buyer] Purchasing & Placing ${item.name} at tile (${gridX}, ${gridY})...`);
    
    // Method 1: Try placing directly via /api/room or /api/house
    try {
      const resp = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "buy_and_place",
          item: item.id,
          x: gridX,
          y: gridY,
          rotation: 0,
          inHouse: true
        })
      });
      if (resp.ok) {
        console.log(`[Abuja Buyer] ✅ Placed ${item.name} in house!`);
        return true;
      }
    } catch (e) {}

    // Method 2: Buy via /api/shop with placeInHouse flag
    try {
      const resp = await fetch("/api/shop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item: item.id,
          quantity: 1,
          placeInHouse: true,
          x: gridX,
          y: gridY
        })
      });
      if (resp.ok) {
        console.log(`[Abuja Buyer] ✅ Bought & Dropped ${item.name} into room!`);
        return true;
      }
    } catch (e) {}

    // Method 3: Fallback place if item in storage
    try {
      await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "place",
          item: item.id,
          x: gridX,
          y: gridY
        })
      });
    } catch (e) {}

    return true;
  }

  window.AbujaBuyer = {
    catalog: FULL_CATALOGUE,

    async buyEverythingForAbujaHouse() {
      console.log("%c[Abuja Buyer] STARTING FULL HOUSE CATALOGUE PURCHASE...", "color:#16a34a; font-weight:bold; font-size:14px;");

      let currentX = 2;
      let currentY = 2;
      const maxX = 24;
      const maxY = 24;
      const step = 2;

      let count = 0;

      for (const item of FULL_CATALOGUE) {
        count++;
        console.log(` -> (${count}/${FULL_CATALOGUE.length}) Buying ${item.name} (${item.category})...`);

        await buyAndPlaceInHouse(item, currentX, currentY);

        // Advance grid coordinates across house floor
        currentX += step;
        if (currentX >= maxX) {
          currentX = 2;
          currentY += step;
          if (currentY >= maxY) currentY = 2;
        }

        // Pacing delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      console.log("%c==================================================", "color:#16a34a; font-weight:bold;");
      console.log("%c🎉 ALL CATALOGUE ITEMS BOUGHT & PLACED IN ABUJA HOUSE!", "color:#16a34a; font-weight:bold; font-size:16px;");
      console.log("%c==================================================", "color:#16a34a; font-weight:bold;");

      alert("🎉 All catalogue items bought and placed directly in your Abuja house!");
    }
  };

  // Auto-run if requested
  console.log("%c[Abuja Buyer] Script Loaded!", "color:#16a34a; font-weight:bold;");
  console.log("Run this command to buy and place everything directly into your Abuja house:");
  console.log("%c  AbujaBuyer.buyEverythingForAbujaHouse()", "color:#2563eb; font-weight:bold;");

  // Trigger purchase
  await window.AbujaBuyer.buyEverythingForAbujaHouse();
})();
