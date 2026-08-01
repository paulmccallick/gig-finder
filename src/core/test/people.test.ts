import { expect, test } from "bun:test";
import { comparePeople, personIsOverdue, type Person } from "../src/people";

const person = (overrides: Partial<Person> = {}): Person => ({
  id: "person", name: "Person", company: "Company", title: "Leader", linkedInProfileUrl: null,
  profileStatus: "missing", connectedOn: null, relationship: { type: "former_colleague", strength: "warm", introducedBy: null, notes: null },
  priority: "medium", status: "not_contacted", outreach: { lastContacted: null, lastContactMethod: null, lastContactSummary: null, nextAction: "Reach out", nextActionDue: "2026-07-15" },
  whyInteresting: null, notes: [], tags: [], createdAt: "2026-07-15", updatedAt: "2026-07-15", ...overrides,
});

  test("person urgency identifies overdue actions and sorts them first", () => {
  const overdue = person({ id: "overdue", outreach: { ...person().outreach, nextActionDue: "2026-07-14" } });
  const future = person({ id: "future", priority: "high", outreach: { ...person().outreach, nextActionDue: "2026-07-20" } });
  expect(personIsOverdue(overdue, "2026-07-16")).toBe(true);
  expect([future, overdue].sort((a, b) => comparePeople(a, b, "2026-07-16"))[0]?.id).toBe("overdue");
});
