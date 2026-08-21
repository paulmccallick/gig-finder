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
  await expect(
    page.getByRole("button", { name: "Head of Orchard Technology" }),
  ).toBeVisible();
  await expect(page.getByText("Director of Synthetic Systems")).toHaveCount(0);
  await expect(page.getByText("score candidate match · completed")).toBeVisible();
  await expect(page.getByRole("cell", { name: "8", exact: true })).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Head of Orchard Technology" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Observation history" }),
  ).toBeVisible();
  await expect(page.getByText("Candidate-match score:")).toBeVisible();
  await expect(page.getByText(/synthetic profile aligns/)).toBeVisible();
  await expect(page.getByText(/run srun_/)).toBeVisible();
});
