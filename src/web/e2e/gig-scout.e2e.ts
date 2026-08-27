import { expect, test } from "@playwright/test";

test("starts, leaves, and reopens a persisted empty Gig Scout run", async ({
  page,
}) => {
  let submittedProfile: unknown;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/gig-scout/runs"
    ) {
      submittedProfile = request.postDataJSON();
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await expect(
    page.getByRole("heading", { name: "Gig Scout", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading",{name:"Positions",exact:true})).toBeVisible();
  await expect(page.getByText("No positions match the active filters.")).toBeVisible();
  await page.getByRole("button",{name:"Run history"}).click();
  await expect(page.getByLabel("Search terms", { exact: true })).toHaveValue(
    /Director/,
  );
  await expect(
    page.getByLabel("Search locations", { exact: true }),
  ).toHaveValue(/Seattle/);
  await page
    .getByLabel("Search terms", { exact: true })
    .fill("nonmatching specialty");
  await page
    .getByLabel("Search locations", { exact: true })
    .fill("Nowhere");
  await page.getByRole("button", { name: "Start full scan" }).click();
  expect(submittedProfile).toEqual({
    searchProfile: {
      terms: ["nonmatching specialty"],
      locations: ["Nowhere"],
    },
  });
  await expect(page.getByRole("status")).toContainText("completed");
  await expect(page.getByLabel("Run search profile")).toContainText(
    "nonmatching specialty",
  );
  await expect(page.getByLabel("Run search profile")).toContainText(
    "Nowhere",
  );
  await page.getByRole("button", { name: /Opportunities/ }).click();
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await page.getByRole("button",{name:"Run history"}).click();
  await expect(
    page.getByText("No positions were observed for this run."),
  ).toBeVisible();
});

test("discovers and processes positions from a full Scout run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await page.getByRole("button", { name: "Run history" }).click();
  await page
    .getByLabel("Search terms", { exact: true })
    .fill("synthetic systems, orchard");
  await page
    .getByLabel("Search locations", { exact: true })
    .fill("Synthetic Region");
  await page.getByRole("button", { name: "Start full scan" }).click();

  await expect(page.getByRole("status")).toContainText("completed");
  await page.getByText("Company diagnostics").click();
  await expect(page.getByText("2/2 accepted")).toBeVisible();

  await expect
    .poll(async () => {
      const response = await page.request.get(
        "/api/gig-scout/positions?state=actionable",
      );
      const body = (await response.json()) as {
        items: Array<{
          title: string;
          state: string;
          processingStatus: string | null;
          descriptionAvailable: boolean;
          score: number | null;
        }>;
      };
      return body.items;
    })
    .toEqual([
      expect.objectContaining({
        title: "Head of Orchard Technology",
        state: "needs_user_review",
        processingStatus: "completed",
        descriptionAvailable: true,
        score: 8,
      }),
    ]);

  await page.getByRole("button", { name: "Positions", exact: true }).click();
  const ledger = page.getByRole("region", { name: "Positions for review" });
  await expect(ledger.getByText("Head of Orchard Technology")).toBeVisible();
  await expect(ledger.getByText("8/10")).toBeVisible();
  await expect(ledger.getByText(/synthetic profile aligns/)).toBeVisible();
  await expect(ledger.getByText("First seen", { exact: true })).toBeVisible();
  await expect(ledger.getByText("Processing", { exact: true })).toHaveCount(0);
  await expect(ledger.getByText("Description", { exact: true })).toHaveCount(0);
  await expect(ledger.getByText("Observations", { exact: true })).toHaveCount(0);

  const agentPanel = page.getByRole("complementary", { name: "GigFinder" });
  const agentLauncher = page.locator(".agent-launcher");
  if (!await agentPanel.isVisible()) {
    await agentLauncher.click();
  }
  await expect(agentPanel).toBeVisible();
  await ledger.getByRole("button", {
    name: /Head of Orchard Technology/,
  }).click();
  await expect(agentPanel).toBeHidden();
  await expect(agentLauncher).toBeHidden();
  const drawer = page.getByRole("dialog", { name: "Head of Orchard Technology" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("8 / 10 match")).toBeVisible();
  await expect(drawer.getByText(/synthetic profile aligns/)).toBeVisible();
  await expect(drawer.getByLabel("Private note (optional)")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Pursue position" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Defer review" })).toBeVisible();

  await drawer.getByLabel("Private note (optional)").fill("Discarded draft");
  await drawer.getByRole("button", { name: "Close position review" }).click();
  await expect(agentLauncher).toBeVisible();
  await ledger.getByRole("button", { name: /Head of Orchard Technology/ }).click();
  await expect(drawer.getByLabel("Private note (optional)")).toHaveValue("");
  await expect(agentLauncher).toBeHidden();

  await drawer.getByRole("button", { name: "Expand description" }).click();
  await expect(drawer.locator(".scout-review-description")).toHaveClass(/is-expanded/);
  const popupPromise = page.waitForEvent("popup");
  await drawer.getByRole("link", {
    name: /Open Head of Orchard Technology description in document view/,
  }).click();
  const viewer = await popupPromise;
  await expect(viewer.getByRole("heading", { name: "Head of Orchard Technology" })).toBeVisible();
  await expect(viewer.getByText("Build and lead the orchard technology team.")).toBeVisible();
  await viewer.getByRole("button", { name: "Back" }).click();
  await expect.poll(() => viewer.isClosed()).toBe(true);
  await expect(drawer).toBeVisible();

  const descriptionUrl = await drawer.locator(".scout-review-document-link")
    .evaluate((link: HTMLAnchorElement) => link.href);
  const directViewer = await page.context().newPage();
  await directViewer.evaluate(url => window.location.replace(url), descriptionUrl);
  await directViewer.waitForLoadState("domcontentloaded");
  await directViewer.getByRole("button", { name: "Back" }).click();
  await expect(directViewer).toHaveURL(/\?workspace=scout$/);
  await expect(directViewer.getByRole("button", { name: "Positions", exact: true })).toBeVisible();
  await directViewer.close();

  await page.setViewportSize({ width: 700, height: 900 });
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
  await expect(drawer.locator(".scout-review-description"))
    .toHaveCSS("overflow-wrap", "anywhere");
  await page.setViewportSize({ width: 1280, height: 900 });

  let failedDecision: { action?: string; note?: string } = {};
  const decisionPattern = "**/api/gig-scout/positions/*/decision";
  await page.route(decisionPattern, async route => {
    failedDecision = route.request().postDataJSON() as typeof failedDecision;
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic decision failure." }),
    });
  });
  await drawer.getByLabel("Private note (optional)").fill("Synthetic review note");
  const failedClick = drawer.getByRole("button", { name: "Mark irrelevant" }).click();
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Close position review" })).toBeDisabled();
  await failedClick;
  await expect(drawer.getByRole("alert")).toContainText("Synthetic decision failure.");
  await expect(drawer.getByLabel("Private note (optional)")).toHaveValue("Synthetic review note");
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeEnabled();
  await expect(ledger.getByText("Head of Orchard Technology")).toBeVisible();
  expect(failedDecision).toMatchObject({ action: "irrelevant", note: "Synthetic review note" });
  await page.unroute(decisionPattern);

  await page.route(decisionPattern, async route => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Position revised." }),
    });
  });
  await drawer.getByRole("button", { name: "Mark irrelevant" }).click();
  await expect(drawer.getByRole("alert")).toContainText("This position was revised");
  await expect(drawer.getByLabel("Private note (optional)")).toHaveValue("Synthetic review note");
  await page.unroute(decisionPattern);

  await drawer.getByLabel("Private note (optional)").fill("");
  await page.evaluate(() => {
    document.body.style.minHeight = "2000px";
    window.scrollTo(0, 240);
  });
  const beforeScroll = await page.evaluate(() => window.scrollY);
  let refreshAttempts = 0;
  const listPattern = "**/api/gig-scout/positions?*";
  await page.route(listPattern, async route => {
    refreshAttempts += 1;
    if (refreshAttempts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await drawer.getByRole("button", { name: "Pursue position" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(ledger.getByText("Head of Orchard Technology")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeScroll);
  await expect(page.getByRole("button", { name: "Retry refresh" })).toBeVisible();
  await page.getByRole("button", { name: "Retry refresh" }).click();
  await expect(page.getByRole("button", { name: "Retry refresh" })).toHaveCount(0);
  expect(refreshAttempts).toBeGreaterThanOrEqual(2);
  await page.unroute(listPattern);
  await expect(page.getByRole("combobox", { name: "View", exact: true }))
    .toHaveValue("needs_user_review");
  await expect.poll(async()=>{const response=await page.request.get("/api/gig-scout/positions");const body=await response.json() as {items:Array<{id:string}>};return body.items.length;}).toBe(0);
});
