import puppeteer from "puppeteer-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log("Launching Chrome...");
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
  await sleep(2000);

  // Accept cookies if present
  try {
    const cookieBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find(b => b.textContent && (b.textContent.includes("Accept") || b.textContent.includes("Essential only")));
    });
    if (cookieBtn && cookieBtn.asElement()) {
      console.log("Clicking Accept/Essential cookies button...");
      await cookieBtn.asElement().click();
      await sleep(1000);
    }
  } catch (e) {
    console.log("Cookie button handling error / not found:", e.message);
  }

  // Click "Log in" button
  console.log("Looking for Log in button...");
  const loginOpened = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const loginBtn = btns.find(b => b.textContent && b.textContent.trim() === "Log in");
    if (loginBtn) {
      loginBtn.click();
      return true;
    }
    return false;
  });
  console.log("Login button clicked:", loginOpened);
  await sleep(1500);

  // Check inputs in modal
  const modalInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      id: i.id,
      className: i.className
    }));
    const buttons = Array.from(document.querySelectorAll("button")).map(b => ({
      text: (b.innerText || b.textContent || "").trim(),
      className: b.className
    }));
    return { inputs, buttons };
  });
  console.log("Modal info:", JSON.stringify(modalInfo, null, 2));

  // Type credentials
  console.log("Filling username and password...");
  // Find username input
  const usernameSelector = 'input[type="text"], input[name="username"], input[autocomplete="username"]';
  await page.waitForSelector(usernameSelector, { timeout: 5000 });
  await page.type(usernameSelector, "princedavid", { delay: 100 });
  await sleep(500);

  // Find password input
  const passwordSelector = 'input[type="password"]';
  await page.waitForSelector(passwordSelector, { timeout: 5000 });
  await page.type(passwordSelector, "Oladelel", { delay: 100 });
  await sleep(500);

  // Click Submit Log in inside the modal / form
  console.log("Submitting login form...");
  await page.evaluate(() => {
    // Find submit button or button inside form / modal
    const forms = Array.from(document.querySelectorAll("form"));
    if (forms.length > 0) {
      const submitBtn = forms[0].querySelector('button[type="submit"]') || 
                        Array.from(forms[0].querySelectorAll("button")).find(b => (b.textContent || "").includes("Log in"));
      if (submitBtn) {
        submitBtn.click();
        return;
      }
    }
    // Fallback: any button with "Log in"
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.reverse().find(b => (b.textContent || "").trim() === "Log in");
    if (btn) btn.click();
  });

  console.log("Waiting for Continue button or town to load...");
  await sleep(4000);

  // Check current page state
  const postLoginInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a")).map(b => ({
      tag: b.tagName,
      text: (b.innerText || b.textContent || "").trim()
    })).filter(b => b.text.length > 0 && b.text.length < 50);

    return {
      url: window.location.href,
      buttons
    };
  });
  console.log("Post login info:", JSON.stringify(postLoginInfo, null, 2));

  // Look for Continue button
  const clickedContinue = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const contBtn = btns.find(b => (b.innerText || b.textContent || "").toLowerCase().includes("continue"));
    if (contBtn) {
      contBtn.click();
      return true;
    }
    return false;
  });
  console.log("Clicked continue:", clickedContinue);

  await sleep(4000);

  // Now check town UI elements, settings/logout button
  const gameUI = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a, div[role='button']")).map(b => ({
      tag: b.tagName,
      text: (b.innerText || b.textContent || "").trim(),
      className: b.className,
      ariaLabel: b.getAttribute("aria-label"),
      title: b.getAttribute("title")
    })).filter(b => b.text.length > 0 || b.ariaLabel || b.title);

    return {
      url: window.location.href,
      buttons
    };
  });
  console.log("Game UI buttons:", JSON.stringify(gameUI, null, 2));

  await sleep(5000);
  await browser.close();
}

runTest().catch(console.error);
