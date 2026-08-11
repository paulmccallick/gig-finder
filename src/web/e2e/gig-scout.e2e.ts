import { expect, test } from "@playwright/test";

test("starts, leaves, and reopens a persisted empty Gig Scout run",async({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:/Gig Scout/}).click();
  await expect(page.getByRole("heading",{name:"Gig Scout",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Start full scan"}).click();
  await expect(page.getByRole("status")).toContainText("completed");
  await page.getByRole("button",{name:/Opportunities/}).click();
  await page.getByRole("button",{name:/Gig Scout/}).click();
  await expect(page.getByText("No positions were observed for this run.")).toBeVisible();
});
