import { expect, test } from "@playwright/test";

test("active board, filters, role drawer, and archive are functional", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Opportunity Control Room" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Networking/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Tasks/ })).toBeVisible();
  const activeCount=await page.locator(".role-card").count();
  expect(activeCount).toBeGreaterThan(0);
  await expect(page.getByText(`${activeCount} roles in view`)).toBeVisible();
  const activeColumns=await page.locator(".kanban-column").count();
  expect(activeColumns).toBeGreaterThan(0);
  await expect(page.getByText("Source: SQLite").first()).toBeVisible();
  await page.screenshot({ path: "test-results/playwright/active-desktop.png", fullPage: false });
  const firstCompany = await page.locator(".role-card .card-company").first().innerText();
  await page.locator(".role-card").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: firstCompany })).toBeVisible();
  await expect(drawer.locator(".drawer-actions")).toContainText(/Apply \/ view posting|No application URL captured/);
  await expect(drawer.locator(".description-section")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByPlaceholder("Search company, title, status…").fill("Chewy");
  await expect(page.locator(".role-card")).toHaveCount(1);
  await expect(page.locator(".kanban-column")).toHaveCount(activeColumns);
  await expect(page.locator(".column-empty")).toHaveCount(activeColumns-1);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".role-card")).toHaveCount(activeCount);
  await page.getByRole("tab", { name: /Archive/ }).click();
  const archiveCount=await page.locator(".role-card").count();
  expect(archiveCount).toBeGreaterThan(0);
  await expect(page.getByText(`${archiveCount} roles in view`)).toBeVisible();
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByRole("heading", { name: "Relationship Control Room" })).toBeVisible();
  await expect(page.getByText("Source: SQLite")).toBeVisible();
  await expect(page.locator(".networking-board .kanban-column")).toHaveCount(4);
  await expect(page.locator(".contact-card").first()).toBeVisible();
  await page.locator(".contact-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Tasks/ }).click();
  await expect(page.getByRole("heading", { name: "Action Control Room" })).toBeVisible();
  await expect(page.getByText("Source: SQLite")).toBeVisible();
  await expect(page.locator(".task-row").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/playwright/tasks-desktop.png", fullPage: false });
  await page.locator(".task-row").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(pageErrors).toEqual([]);
});

test("mobile board remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const agentPanel = page.getByRole("complementary", { name: "Job Search Agent" });
  await expect(agentPanel).toBeVisible();
  await agentPanel.getByRole("button", { name: "Close Job Search Agent" }).click();
  await expect(page.getByRole("heading", { name: "Opportunity Control Room" })).toBeVisible();
  expect(await page.locator(".role-card").count()).toBeGreaterThan(0);
  await page.locator(".role-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  const drawerBox = await page.getByRole("dialog").boundingBox();
  expect(drawerBox?.x).toBeLessThanOrEqual(30);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByRole("heading", { name: "Relationship Control Room" })).toBeVisible();
  await expect(page.locator(".networking-board")).toBeVisible();
  await page.getByRole("button", { name: /Tasks/ }).click();
  await expect(page.getByRole("heading", { name: "Action Control Room" })).toBeVisible();
  await expect(page.locator(".task-ledger")).toBeVisible();
  await page.getByRole("button", { name: /Ask JobSearchAgent/ }).click();
  await expect(page.getByRole("complementary", { name: "Job Search Agent" })).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-results/playwright/agent-mobile.png", fullPage: false });
});

test("session-only JobSearchAgent streams guidance and remains available across dashboard views", async ({ page }) => {
  const stream = [
    'data: {"type":"start","messageId":"assistant-1"}',
    'data: {"type":"start-step"}',
    'data: {"type":"text-start","id":"text-1"}',
    'data: {"type":"text-delta","id":"text-1","delta":"Prioritize Senior Director and VP engineering roles with credible organizational scope."}',
    'data: {"type":"text-end","id":"text-1"}',
    'data: {"type":"finish-step"}',
    'data: {"type":"finish"}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  await page.route("**/api/agent/messages", async route => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    const body = request.postDataJSON() as { messages: Array<{ role: string }> };
    expect(body.messages.at(-1)?.role).toBe("user");
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-store",
      },
      body: stream,
    });
  });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Job Search Agent" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Live applications, contacts, tasks, and documents are not connected yet.");
  await panel.getByRole("button", { name: "What kinds of roles should I prioritize?" }).click();
  await expect(panel).toContainText("Prioritize Senior Director and VP engineering roles");
  await page.screenshot({ path: "test-results/playwright/agent-desktop.png", fullPage: false });
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByRole("heading", { name: "Relationship Control Room" })).toBeVisible();
  await expect(panel).toContainText("Prioritize Senior Director and VP engineering roles");
  await panel.getByRole("button", { name: "Close Job Search Agent" }).click();
  await expect(panel).toBeHidden();
});
