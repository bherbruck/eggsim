// Loads the built page without pausing and checks that frames and belt position advance on their own.
import { chromium } from "playwright";
import path from "node:path";
const file = process.argv[2] || "dist/index.html";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(file.startsWith("http") ? file : "file://" + path.resolve(file));
await page.waitForFunction(() => window.eggsim && document.getElementById("busy").hidden, null, { timeout: 120000 });
const a = await page.evaluate(() => [window.eggsim.view.frameNo, window.eggsim.world.simTime]);
await page.waitForTimeout(4000);
const b = await page.evaluate(() => [window.eggsim.view.frameNo, window.eggsim.world.simTime]);
console.log(`frames ${a[0]} -> ${b[0]}, sim time ${a[1].toFixed(2)}s -> ${b[1].toFixed(2)}s`);
console.log(b[0] > a[0] + 5 && b[1] > a[1] + 0.3 ? "PLAYING" : "NOT PLAYING");
await browser.close();
