(async function initQuiloxClubTapper() {
  console.log("%c==================================================", "color:#db2777; font-weight:bold;");
  console.log("%c🍾 [LagosLife Quilox Nightclub Auto-Tapper & Spender]", "color:#db2777; font-weight:bold; font-size:16px;");
  console.log("%c==================================================", "color:#db2777; font-weight:bold;");

  let isTapping = true;
  let totalSpent = 0n;
  let actionsCount = 0;

  const ACTIONS_CATALOG = [
    { id: "takeOverQuilox", label: "Take Over Quilox for the Night", cost: 1_000_000_000n, selector: "Take Over Quilox" },
    { id: "clubShutdown", label: "Shut Down the Club", cost: 1_000_000_000n, selector: "Shut Down the Club" },
    { id: "bigTable", label: "Book the Big Man VIP Table", cost: 500_000_000n, selector: "Book the Big Man" },
    { id: "topShelf", label: "Top-Shelf Round for the Club", cost: 100_000_000n, selector: "Top Shelf" },
    { id: "sneakVip", label: "VIP Section Access", cost: 50_000_000n, selector: "Sneak into" }
  ];

  // Helper 1: Trigger via DOM element clicks (Direct UI Simulation)
  function clickClubButtonsInUI() {
    let clickedAny = false;

    // Find all buttons / cards containing spending text
    const elements = document.querySelectorAll("button, div, [role='button']");
    elements.forEach(el => {
      const text = el.innerText || el.textContent || "";
      for (const act of ACTIONS_CATALOG) {
        if (text.includes(act.selector) || text.includes(act.label)) {
          // Verify it's clickable
          if (el.offsetWidth > 0 && el.offsetHeight > 0) {
            console.log(`%c[Club Tapper] Tapping UI Card: ${act.label} (₦${act.cost.toLocaleString()})`, "color:#db2777; font-weight:bold;");
            el.click();
            totalSpent += act.cost;
            actionsCount++;
            clickedAny = true;
          }
        }
      }
    });

    return clickedAny;
  }

  // Helper 2: Trigger via direct API / State Save
  async function triggerClubActionsViaAPI() {
    try {
      const saveResp = await fetch("/api/save");
      if (!saveResp.ok) return;

      const saveData = await saveResp.json();
      if (!saveData.game) return;

      const currentQueue = saveData.game.queue || [];

      // Check if queue has space
      if (currentQueue.length < 5) {
        const newAction = {
          uid: Math.random().toString(36).substring(2, 10),
          actionId: "takeOverQuilox",
          label: "Take Over Quilox for the Night",
          emoji: "👑",
          progress: 0,
          started: false
        };

        saveData.game.queue.push(newAction);

        await fetch("/api/save", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(saveData)
        });

        console.log("%c[Club Tapper] Enqueued Take Over Quilox via API!", "color:#16a34a; font-weight:bold;");
        totalSpent += 1_000_000_000n;
        actionsCount++;
      }
    } catch (e) {
      console.error("[Club Tapper API Error]:", e.message);
    }
  }

  window.LL_ClubTapper = {
    running: true,

    start(intervalMs = 2000) {
      this.running = true;
      console.log(`%c[Club Tapper] AUTO-TAPPER STARTED (Interval: ${intervalMs}ms)...`, "color:#16a34a; font-weight:bold;");

      const loop = async () => {
        if (!this.running) return;

        // Try UI click first
        const uiClicked = clickClubButtonsInUI();

        // Backup API enqueue
        if (!uiClicked) {
          await triggerClubActionsViaAPI();
        }

        if (this.running) {
          setTimeout(loop, intervalMs);
        }
      };

      loop();
    },

    stop() {
      this.running = false;
      console.log("%c[Club Tapper] AUTO-TAPPER PAUSED.", "color:#dc2626; font-weight:bold;");
    },

    stats() {
      console.log("=== Quilox Club Tapper Stats ===");
      console.log(`Total Actions Triggered: ${actionsCount}`);
      console.log(`Total Money Spent: ₦${totalSpent.toLocaleString()}`);
      console.log(`Status: ${this.running ? "Active 🟢" : "Paused 🔴"}`);
    }
  };

  // Auto-start tapper every 2 seconds
  window.LL_ClubTapper.start(2000);

  alert("🍾 Quilox Club Auto-Tapper Loaded & Active!\nIt will automatically tap 'Take Over Quilox', 'Shut Down the Club', and VIP tables every 2 seconds.\n\nOpen console (F12) to monitor stats with LL_ClubTapper.stats()");
})();
