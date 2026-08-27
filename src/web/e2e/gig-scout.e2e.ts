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

  await ledger.getByRole("button", {
    name: /Head of Orchard Technology/,
  }).click();
  const drawer = page.getByRole("dialog", { name: "Head of Orchard Technology" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("8 / 10 match")).toBeVisible();
  await expect(drawer.getByText(/synthetic profile aligns/)).toBeVisible();
  await expect(drawer.getByLabel("Private note (optional)")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Pursue position" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Mark irrelevant" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Defer review" })).toBeVisible();
  await drawer.getByRole("button", { name: "Pursue position" }).click();
  await expect(page.getByRole("heading", { name: "Positions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Head of Orchard Technology" })).toHaveCount(0);
  await expect.poll(async()=>{const response=await page.request.get("/api/gig-scout/positions");const body=await response.json() as {items:Array<{id:string}>};return body.items.length;}).toBe(0);
});
