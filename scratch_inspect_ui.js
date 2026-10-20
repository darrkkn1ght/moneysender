import puppeteer from "puppeteer-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function testUi() {
  console.log("Launching visible Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--no-sandbox"]
  });

  const page = await browser.newPage();
  console.log("Navigating to https://lagoslife.app...");
  await page.goto("https://lagoslife.app", { waitUntil: "networkidle2" });

  console.log("Waiting 3s for page load...");
  await new Promise(r => setTimeout(r, 3000));

  // Get all buttons and inputs on screen
  const elements = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a")).map(b => ({
      tag: b.tagName,
      text: (b.innerText || b.textContent || "").trim(),
      id: b.id,
      className: b.className
    })).filter(b => b.text.length > 0 && b.text.length < 50);

    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      id: i.id
    }));

    return { buttons, inputs };
  });

  console.log("Visible Inputs:", elements.inputs);
  console.log("Visible Buttons:", elements.buttons);

  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

testUi().catch(console.error);
