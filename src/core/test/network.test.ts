import { expect, test } from "bun:test";
import { compareContacts, contactIsOverdue, type NetworkContact } from "../src/network";

const contact = (overrides: Partial<NetworkContact> = {}): NetworkContact => ({
  id: "person", name: "Person", company: "Company", title: "Leader", linkedInProfileUrl: null,
  profileStatus: "missing", connectedOn: null, relationship: { type: "former_colleague", strength: "warm", introducedBy: null, notes: null },
  priority: "medium", status: "not_contacted", outreach: { lastContacted: null, lastContactMethod: null, lastContactSummary: null, nextAction: "Reach out", nextActionDue: "2026-07-15" },
  whyInteresting: null, notes: [], tags: [], source: { files: ["fixture"] }, createdAt: "2026-07-15", updatedAt: "2026-07-15", ...overrides,
});

test("network urgency identifies overdue actions and sorts them first", () => {
  const overdue = contact({ id: "overdue", outreach: { ...contact().outreach, nextActionDue: "2026-07-14" } });
  const future = contact({ id: "future", priority: "high", outreach: { ...contact().outreach, nextActionDue: "2026-07-20" } });
  expect(contactIsOverdue(overdue, "2026-07-16")).toBe(true);
  expect([future, overdue].sort((a, b) => compareContacts(a, b, "2026-07-16"))[0]?.id).toBe("overdue");
});
