import puppeteer from "puppeteer-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TOTAL_CYCLES = 10;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBrowserLoop() {
  console.log("==================================================");
  console.log(`Starting Prince David UI Automation Loop (${TOTAL_CYCLES} cycles)`);
  console.log("Launching visible Google Chrome...");
  console.log("==================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"]
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  console.log("Navigating to https://lagoslife.app...");
  await page.goto("https://lagoslife.app", { waitUntil: "networkidle2" });
  await sleep(2500);

  // Accept cookies if banner is present
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find(x => x.textContent && (x.textContent.includes("Accept") || x.textContent.includes("Essential only")));
      if (b) b.click();
    });
    await sleep(1000);
  } catch (e) {}

  for (let cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
    console.log(`\n--------------------------------------------------`);
    console.log(`>>> [CYCLE ${cycle} / ${TOTAL_CYCLES}] IN PROGRESS`);
    console.log(`--------------------------------------------------`);

    // Step 1: Click "Log in" button on landing page if not already in modal
    console.log(`[Cycle ${cycle}] Step 1: Opening login dialog...`);
    const modalAlreadyOpen = await page.evaluate(() => {
      return document.querySelector('input[type="password"]') !== null;
    });

    if (!modalAlreadyOpen) {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const loginBtn = btns.find(b => (b.innerText || b.textContent || "").trim() === "Log in");
        if (loginBtn) loginBtn.click();
      });
      await sleep(1500);
    }

    // Step 2: Fill in credentials
    console.log(`[Cycle ${cycle}] Step 2: Typing username and password...`);
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
    
    // Clear existing text if any
    await page.evaluate(() => {
      const u = document.querySelector('input[name="username"], input[type="text"]');
      if (u) u.value = "";
      const p = document.querySelector('input[name="password"], input[type="password"]');
      if (p) p.value = "";
    });

    await page.type('input[name="username"], input[type="text"]', "princedavid", { delay: 60 });
    await sleep(300);
    await page.type('input[name="password"], input[type="password"]', "Oladelel", { delay: 60 });
    await sleep(500);

    // Step 3: Click Submit Log in
    console.log(`[Cycle ${cycle}] Step 3: Submitting login...`);
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const submitBtn = buttons.reverse().find(b => (b.textContent || "").trim() === "Log in");
      if (submitBtn) submitBtn.click();
    });

    // Step 4: Wait for "Continue" button
    console.log(`[Cycle ${cycle}] Step 4: Waiting for 'Continue' button...`);
    let continueFound = false;
    for (let w = 0; w < 20; w++) {
      await sleep(800);
      continueFound = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const cont = btns.find(b => (b.innerText || b.textContent || "").toLowerCase().includes("continue"));
        if (cont) {
          cont.click();
          return true;
        }
        return false;
      });
      if (continueFound) {
        console.log(`[Cycle ${cycle}] Clicked 'Continue'!`);
        break;
      }
    }

    // Step 5: Wait for game / scene to load
    console.log(`[Cycle ${cycle}] Step 5: Game loading, preparing for logout...`);
    await sleep(4000);

    // Dismiss any popups like "Nice one" if they appear
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const niceOne = btns.find(b => (b.textContent || "").includes("Nice one"));
      if (niceOne) niceOne.click();
    });
    await sleep(1000);

    // Step 6: Open Sim panel to access Logout
    console.log(`[Cycle ${cycle}] Step 6: Opening Sim panel...`);
    let panelOpened = false;
    for (let p = 0; p < 10; p++) {
      panelOpened = await page.evaluate(() => {
        const simBtn = document.querySelector('button[aria-label="Open Sim panel"]');
        if (simBtn) {
          simBtn.click();
          return true;
        }
        return false;
      });
      if (panelOpened) break;
      await sleep(1000);
    }
    await sleep(1500);

    // Step 7: Click "Log out"
    console.log(`[Cycle ${cycle}] Step 7: Clicking 'Log out'...`);
    let loggedOut = false;
    for (let lo = 0; lo < 10; lo++) {
      loggedOut = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const logoutBtn = btns.find(b => (b.innerText || b.textContent || "").toLowerCase().includes("log out"));
        if (logoutBtn) {
          logoutBtn.click();
          return true;
        }
        return false;
      });
      if (loggedOut) {
        console.log(`[Cycle ${cycle}] Clicked 'Log out'!`);
        break;
      }
      await sleep(1000);
    }

    // Wait for logout confirmation or redirect to landing page
    await sleep(3000);

    // Check if back on landing page or if confirmation needed
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const confirmLogout = btns.find(b => (b.innerText || b.textContent || "").toLowerCase() === "log out" || (b.innerText || b.textContent || "").toLowerCase() === "yes");
      if (confirmLogout) confirmLogout.click();
    });

    await sleep(2000);
    console.log(`>>> [CYCLE ${cycle} / ${TOTAL_CYCLES}] COMPLETED SUCCESSFULLY!`);
    await sleep(1500);
  }

  console.log("\n==================================================");
  console.log(`All ${TOTAL_CYCLES} cycles completed successfully!`);
  console.log("==================================================");
  await sleep(3000);
  await browser.close();
}

runBrowserLoop().catch(console.error);
