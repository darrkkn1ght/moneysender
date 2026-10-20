import puppeteer from "puppeteer-core";
import { exec } from "child_process";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TOTAL_CYCLES = 10;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bringToForeground() {
  const psCommand = `powershell -Command "$p = Get-Process chrome | Where-Object { $_.MainWindowTitle -match 'LagosLife' -or $_.MainWindowTitle -match 'Chrome' } | Select-Object -First 1; if ($p) { $sig = '[DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'; Add-Type -MemberDefinition $sig -Name 'Win32' -Namespace Win32Util -ErrorAction SilentlyContinue; [Win32Util.Win32]::ShowWindow($p.MainWindowHandle, 3); [Win32Util.Win32]::SetForegroundWindow($p.MainWindowHandle); }"`;
  exec(psCommand, () => {});
}

async function getWalletBalance(page) {
  return await page.evaluate(() => {
    // Look for button or div with Wallet in aria-label or ₦ in text
    const buttons = Array.from(document.querySelectorAll("button, div, span"));
    const walletEl = buttons.find(b => {
      const aria = b.getAttribute("aria-label") || "";
      const text = b.innerText || b.textContent || "";
      return aria.includes("Wallet") || (text.includes("₦") && text.length < 30);
    });

    if (walletEl) {
      const aria = walletEl.getAttribute("aria-label") || "";
      const text = (walletEl.innerText || walletEl.textContent || "").trim();
      return { text, aria };
    }
    return null;
  });
}

async function run() {
  console.log("==================================================");
  console.log(`Starting Prince David Visible UI Automation Loop`);
  console.log(`Target: Track wallet balance across ${TOTAL_CYCLES} cycles`);
  console.log("==================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--new-window",
      "--no-default-browser-check"
    ]
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  console.log("Navigating to https://lagoslife.app...");
  await page.goto("https://lagoslife.app", { waitUntil: "networkidle2" });
  await sleep(2000);
  bringToForeground();

  // Accept cookies if present
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find(x => x.textContent && (x.textContent.includes("Accept") || x.textContent.includes("Essential only")));
      if (b) b.click();
    });
    await sleep(1000);
  } catch (e) {}

  let previousBalanceText = null;

  for (let cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
    console.log(`\n==================================================`);
    console.log(`>>> [CYCLE ${cycle} / ${TOTAL_CYCLES}]`);
    console.log(`==================================================`);
    bringToForeground();

    // Check if we are already logged in or need to log in
    const isLoggedIn = await page.evaluate(() => {
      return document.querySelector('button[aria-label="Open Sim panel"]') !== null;
    });

    if (!isLoggedIn) {
      // Check if "Continue" is already on screen
      let contBtn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const c = btns.find(b => (b.innerText || b.textContent || "").trim() === "Continue");
        if (c) {
          c.click();
          return true;
        }
        return false;
      });

      if (!contBtn) {
        // Need to click "Log in" and enter credentials
        console.log(`[Cycle ${cycle}] Opening login modal...`);
        let modalReady = await page.evaluate(() => {
          return document.querySelector('input[name="password"]') !== null;
        });

        if (!modalReady) {
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            // Landing page login button
            const b = btns.find(x => (x.innerText || x.textContent || "").trim() === "Log in");
            if (b) b.click();
          });
          await sleep(1500);
        }

        console.log(`[Cycle ${cycle}] Entering princedavid credentials...`);
        // Wait for username input
        try {
          await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 8000 });
        } catch (e) {
          // If login button wasn't clicked, try again
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            const b = btns.find(x => (x.innerText || x.textContent || "").trim() === "Log in");
            if (b) b.click();
          });
          await sleep(2000);
        }

        // Fill username & password
        await page.evaluate(() => {
          const u = document.querySelector('input[name="username"], input[type="text"]');
          if (u) {
            u.value = "princedavid";
            u.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const p = document.querySelector('input[name="password"], input[type="password"]');
          if (p) {
            p.value = "Oladelel";
            p.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        await sleep(500);

        // Click Log in submit
        console.log(`[Cycle ${cycle}] Submitting login form...`);
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const submitBtn = buttons.reverse().find(b => (b.textContent || "").trim() === "Log in");
          if (submitBtn) submitBtn.click();
        });

        // Wait for Continue button
        console.log(`[Cycle ${cycle}] Waiting for 'Continue' button...`);
        for (let i = 0; i < 15; i++) {
          await sleep(1000);
          const clicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll("button"));
            const c = btns.find(b => (b.innerText || b.textContent || "").trim() === "Continue");
            if (c) {
              c.click();
              return true;
            }
            return false;
          });
          if (clicked) {
            console.log(`[Cycle ${cycle}] 'Continue' clicked!`);
            break;
          }
        }
      }
    }

    // Now wait for in-game canvas and wallet to load
    console.log(`[Cycle ${cycle}] In-game scene loading, checking wallet balance...`);
    await sleep(4000);

    // Dismiss any popups like "Nice one"
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const niceOne = btns.find(b => (b.textContent || "").includes("Nice one"));
      if (niceOne) niceOne.click();
    });
    await sleep(1000);

    // Read wallet balance
    let currentBalance = null;
    for (let b = 0; b < 10; b++) {
      currentBalance = await getWalletBalance(page);
      if (currentBalance) break;
      await sleep(1000);
    }

    if (currentBalance) {
      console.log(`\n💰 >>> [CYCLE ${cycle} BALANCE REPORT] <<<`);
      console.log(`   Text:  ${currentBalance.text}`);
      console.log(`   Label: ${currentBalance.aria}`);
      if (previousBalanceText) {
        console.log(`   Previous: ${previousBalanceText}`);
        console.log(`   Change detected? ${currentBalance.text !== previousBalanceText ? "YES! Changed from " + previousBalanceText + " -> " + currentBalance.text : "No change."}`);
      }
      previousBalanceText = currentBalance.text;
      console.log(`--------------------------------------------------\n`);
    } else {
      console.log(`[Cycle ${cycle}] ⚠️ Could not locate wallet button in UI.`);
    }

    // Now Log Out
    console.log(`[Cycle ${cycle}] Opening Sim panel to Log out...`);
    await page.evaluate(() => {
      const simBtn = document.querySelector('button[aria-label="Open Sim panel"]');
      if (simBtn) simBtn.click();
    });
    await sleep(2000);

    console.log(`[Cycle ${cycle}] Clicking 'Log out'...`);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const logoutBtn = btns.find(b => (b.innerText || b.textContent || "").toLowerCase().includes("log out"));
      if (logoutBtn) logoutBtn.click();
    });
    await sleep(2500);

    // Check if logout confirmed or if page needs reload/redirect to landing
    const onLanding = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const logInBtn = btns.find(b => (b.innerText || b.textContent || "").trim() === "Log in");
      return logInBtn !== undefined;
    });

    if (!onLanding) {
      console.log(`[Cycle ${cycle}] Navigating back to https://lagoslife.app to ensure clean landing page...`);
      await page.goto("https://lagoslife.app", { waitUntil: "networkidle2" });
      await sleep(2000);
    }

    console.log(`>>> [CYCLE ${cycle} / ${TOTAL_CYCLES}] COMPLETED!`);
    await sleep(2000);
  }

  console.log("\n==================================================");
  console.log(`Finished all ${TOTAL_CYCLES} cycles!`);
  console.log("==================================================");
  await sleep(4000);
  await browser.close();
}

run().catch(console.error);
