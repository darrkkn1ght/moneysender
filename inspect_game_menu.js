import puppeteer from "puppeteer-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function inspectGameMenu() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"]
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  await page.goto("https://lagoslife.app", { waitUntil: "networkidle2" });
  await sleep(1500);

  // Accept cookies
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find(x => x.textContent && (x.textContent.includes("Accept") || x.textContent.includes("Essential only")));
      if (b) b.click();
    });
  } catch(e) {}
  await sleep(1000);

  // Log in
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => x.textContent && x.textContent.trim() === "Log in");
    if (b) b.click();
  });
  await sleep(1000);

  await page.type('input[type="text"], input[name="username"]', "princedavid", { delay: 50 });
  await page.type('input[type="password"]', "Oladelel", { delay: 50 });
  await sleep(300);

  // Click Submit
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.reverse().find(b => (b.textContent || "").trim() === "Log in");
    if (btn) btn.click();
  });

  await sleep(3000);

  // Click Continue
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(x => (x.innerText || x.textContent || "").toLowerCase().includes("continue"));
    if (b) b.click();
  });

  console.log("Waiting for game to load...");
  await sleep(5000);

  // Dismiss any popups like "Nice one"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const niceOne = btns.find(b => (b.textContent || "").includes("Nice one"));
    if (niceOne) niceOne.click();
  });
  await sleep(1000);

  // Click Open Sim panel
  console.log("Clicking Open Sim panel...");
  await page.evaluate(() => {
    const simBtn = document.querySelector('button[aria-label="Open Sim panel"]');
    if (simBtn) simBtn.click();
  });
  await sleep(2000);

  const simPanelButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, a, div[role='button']")).map(b => ({
      tag: b.tagName,
      text: (b.innerText || b.textContent || "").trim(),
      ariaLabel: b.getAttribute("aria-label"),
      title: b.getAttribute("title")
    })).filter(b => b.text.length > 0 && b.text.length < 50);
  });
  console.log("Sim Panel Buttons:", JSON.stringify(simPanelButtons, null, 2));

  await sleep(5000);
  await browser.close();
}

inspectGameMenu().catch(console.error);
