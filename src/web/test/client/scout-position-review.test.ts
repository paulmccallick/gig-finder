import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  nearestPageOffset,
  PositionReviewDrawer,
} from "../../client/ScoutPositionReview";

const detail = {
  id: "spos_0123456789abcdef",
  title: "Director of Identity Platforms",
  company: "Example Payments",
  location: "Bellevue, WA",
  canonicalUrl: "https://careers.example.test/jobs/REQ-NEW",
  externalId: "REQ-NEW",
  state: "needs_user_review",
  stateRevision: 4,
  processingStage: "candidate_match",
  processingStatus: "completed",
  processingFailureMessage: null,
  descriptionAvailable: true,
  firstSeenAt: "2026-08-30T12:00:00.000Z",
  lastSeenAt: "2026-09-01T12:00:00.000Z",
  observationCount: 1,
  score: 9,
  scoreExplanation: "Synthetic leadership evidence.",
  criteriaVersion: 1,
  rubricVersion: 1,
  profileVersion: "profile-v1",
  model: "synthetic-model",
  provider: "synthetic-provider",
  descriptionId: "spdesc_synthetic",
  descriptionMarkdown: "# New posting",
  descriptionSourceUrl: "https://careers.example.test/jobs/REQ-NEW",
  descriptionRetrievedAt: "2026-09-01T12:00:00.000Z",
  descriptionProvenance: {},
  relevanceEvaluationId: "srel_synthetic",
  relevanceReason: "Relevant.",
  candidateMatchEvaluationId: "smatch_synthetic",
  observations: [],
};

const candidate = {
  gigId: "gig-existing",
  revision: 3,
  company: "Example Payments",
  title: "Director of Identity Platforms",
  externalJobId: "REQ-EXISTING",
  sourceUrl: "https://careers.example.test/jobs/REQ-EXISTING",
  location: "Remote",
  stage: "applied",
  outcome: "pending",
  availability: "available",
  lastActivity: "2026-08-29",
  jobDescription: {
    id: "doc_11111111-1111-4111-8111-111111111111",
    type: "job_description",
    title: "Existing role description",
    displayName: "Existing role description",
    version: 2,
  },
  matchReasons: ["company_title"],
};

describe("Scout position review pagination", () => {
  test("keeps a valid offset and repairs an empty final page", () => {
    expect(nearestPageOffset(39, 20, 20)).toBe(20);
    expect(nearestPageOffset(20, 20, 20)).toBe(0);
    expect(nearestPageOffset(0, 20, 20)).toBe(0);
  });

  test("rejects invalid pagination inputs", () => {
    expect(() => nearestPageOffset(-1, 0, 20)).toThrow();
    expect(() => nearestPageOffset(1, -1, 20)).toThrow();
    expect(() => nearestPageOffset(1, 0, 0)).toThrow();
  });
});

describe("Scout posting identity comparison", () => {
  test("renders the reviewed posting and every approved existing Gig field", () => {
    const markup = renderToStaticMarkup(createElement(PositionReviewDrawer, {
      detail,
      error: null,
      note: "",
      reviewAt: "",
      resolutionReview: {
        fingerprint: "a".repeat(64),
        candidates: [candidate],
      },
      resolutionChoice: null,
      onClose: () => undefined,
      onNoteChange: () => undefined,
      onReviewAtChange: () => undefined,
      onDecide: () => undefined,
      onResolve: () => undefined,
      onRetryPromotion: () => undefined,
      submittingAction: null,
    }));

    for (const expected of [
      "Reviewed Scout posting",
      "Example Payments",
      "Director of Identity Platforms",
      "REQ-NEW",
      "Bellevue, WA",
      "Existing Gig",
      "REQ-EXISTING",
      "Remote",
      "Applied",
      "Pending",
      "Available",
      "Aug 29, 2026",
    ]) expect(markup).toContain(expected);
    expect(markup).toContain("https://careers.example.test/jobs/REQ-NEW");
    expect(markup).toContain("https://careers.example.test/jobs/REQ-EXISTING");
    expect(markup).toContain("/gig-scout/positions/spos_0123456789abcdef/description");
    expect(markup).toContain("/documents/doc_11111111-1111-4111-8111-111111111111/versions/2");
    expect(markup).toContain("Use this Gig");
    expect(markup).toContain("Create separate Gig");
    expect(markup).not.toContain("Pursue position");
  });
});
