import { expect, test } from "bun:test";
import { comparePeople, type Person } from "../people";

const person = (overrides: Partial<Person> = {}): Person => ({
  id: "person", name: "Person", company: "Company", title: "Leader", linkedInProfileUrl: null,
  profileStatus: "missing", connectedOn: null, relationship: { type: "former_colleague", strength: "warm", introducedBy: null, notes: null },
  priority: "medium", status: "not_contacted", lastContacted: null, lastContactMethod: null, lastContactSummary: null,
  whyInteresting: null, notes: [], tags: [], createdAt: "2026-07-15", updatedAt: "2026-07-15", ...overrides,
});

test("people sort by relationship priority and then name", () => {
  const medium = person({ id: "medium", name: "Alex" });
  const high = person({ id: "high", name: "Zed", priority: "high" });
  expect([medium, high].sort(comparePeople).map(item => item.id)).toEqual(["high", "medium"]);
});
