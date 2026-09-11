import { chromium } from "playwright-core";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const see = async (locator, msg) => {
  await locator.waitFor({ timeout: 8000 });
  console.log("ok -", msg);
};
const assert = (cond, msg) => { if (!cond) throw new Error("SMOKE FAIL: " + msg); console.log("ok -", msg); };

await page.goto(base + "/", { waitUntil: "networkidle" });
await see(page.getByText("RealEstateCRM").first(), "app shell renders");
await see(page.getByText("Demo mode").first(), "demo-mode banner visible");
await see(page.getByText("Total contacts"), "dashboard stats render");

await page.getByRole("link", { name: "Contacts" }).click();
await see(page.getByRole("link", { name: /Jordan Miles/ }), "seeded contact listed");

await page.getByRole("link", { name: "New Lead", exact: true }).click();
await page.getByRole("button", { name: "Capture lead" }).click();
await see(page.getByText(/email address or phone number/), "validation blocks empty lead");
await page.getByLabel("First name").fill("Taylor");
await page.getByLabel("Last name").fill("Tester");
await page.getByLabel("Email").fill("taylor@test.com");
await page.getByLabel("Phone").fill("555-777-6666");
await page.getByLabel("Source", { exact: true }).selectOption("open_house");
await page.getByRole("button", { name: "Capture lead" }).click();
await page.waitForURL("**/contacts/*");
await see(page.getByRole("heading", { name: "Taylor Tester" }), "redirected to new contact detail");
await see(page.getByText("Lead captured"), "capture activity on timeline");
await see(page.getByText("Lead assigned"), "assignment activity on timeline");
await see(page.getByText("open_house").first(), "original source shown");

await page.getByLabel("Add a note").fill("Met at the open house, wants a follow-up");
await page.getByRole("button", { name: "Save note" }).click();
await see(page.getByText("Met at the open house"), "note appears on timeline");

await page.getByLabel("Stage").selectOption("engaged");
await see(page.getByText("Stage: new → engaged"), "stage change recorded on timeline");

// Contact editing: type, consent, reassignment
await page.getByLabel("Contact type").selectOption("buyer");
await page.getByLabel("SMS consent").selectOption("granted");
await page.getByLabel("Assignee").selectOption({ index: 2 });
await see(page.getByText("Reassigned"), "reassignment recorded on timeline");

// AUTO-001: capturing Taylor should have auto-created a follow-up task
await page.getByRole("link", { name: "Tasks" }).click();
await see(page.getByText("Follow up with new lead").first(), "automation created a follow-up task");

// Tasks: create, complete, verify timeline linkage
await page.getByLabel("Title").fill("Follow up with Taylor");
await page.getByLabel("Contact (optional)").selectOption({ label: "Taylor Tester" });
await page.getByRole("button", { name: "Add task" }).click();
await see(page.getByText("Follow up with Taylor"), "task created and listed");
await page.getByRole("button", { name: "Complete" }).first().click();
await see(page.getByText(/Done \(/), "task moves to done");
await page.getByRole("link", { name: /Taylor Tester/ }).first().click();
await see(page.getByText("Task created: Follow up with Taylor"), "task event on contact timeline");

await page.getByRole("link", { name: "Settings" }).click();
await see(page.getByText("Automation activity"), "automation activity panel renders");
await see(page.getByText("new_lead_followup").first(), "workflow run listed with status");

const sms = page.getByRole("switch", { name: /Outbound SMS/ });
await sms.waitFor();
assert((await sms.getAttribute("aria-checked")) === "true", "SMS switch starts enabled");
await sms.click();
await page.waitForFunction(
  () => document.querySelector('[role="switch"][aria-label^="Outbound SMS"]')?.getAttribute("aria-checked") === "false",
  { timeout: 5000 },
);
console.log("ok - SMS kill switch toggles off");

const fatal = errors.filter((e) => !e.includes("favicon"));
assert(fatal.length === 0, "no console/page errors (" + fatal.join("; ") + ")");

await browser.close();
console.log("SMOKE TEST PASSED");
