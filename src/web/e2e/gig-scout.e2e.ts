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
  await page.getByLabel("Search terms").fill("synthetic systems, orchard");
  await page.getByLabel("Search locations").fill("Synthetic Region");
  await page.getByRole("button", { name: "Start full scan" }).click();
  expect(submittedProfile).toEqual({
    searchProfile: {
      terms: ["synthetic systems", "orchard"],
      locations: ["Synthetic Region"],
    },
  });
  await expect(page.getByRole("status")).toContainText("completed");
  await page.getByRole("button", { name: /Opportunities/ }).click();
  await page.getByRole("button", { name: /Gig Scout/ }).click();
  await expect(
    page.getByText("No positions were observed for this run."),
  ).toBeVisible();
});
