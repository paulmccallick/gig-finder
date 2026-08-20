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
    .fill("synthetic systems, orchard");
  await page
    .getByLabel("Search locations", { exact: true })
    .fill("Synthetic Region");
  await page.getByRole("button", { name: "Start full scan" }).click();
  expect(submittedProfile).toEqual({
    searchProfile: {
      terms: ["synthetic systems", "orchard"],
      locations: ["Synthetic Region"],
    },
  });
  await expect(page.getByRole("status")).toContainText("completed");
  await expect(page.getByLabel("Run search profile")).toContainText(
    "synthetic systems",
  );
  await expect(page.getByLabel("Run search profile")).toContainText(
    "Synthetic Region",
  );
  await page.getByRole("button", { name: /Opportunities/ }).click();
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await page.getByRole("button",{name:"Run history"}).click();
  await expect(
    page.getByText("No positions were observed for this run."),
  ).toBeVisible();
});
