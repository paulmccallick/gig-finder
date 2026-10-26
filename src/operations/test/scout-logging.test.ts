import { expect, test } from "bun:test";
import {
  boundedLogValue,
  LoggingScoutHttpPort,
  safeScoutLog,
  sanitizedHeaders,
  sanitizedLogText,
} from "../scout-logging";

test("private request and response context is logged while authentication material is sanitized", async () => {
  const events: Array<Record<string, unknown>> = [];
  const logger = {
    info(fields: Record<string, unknown>) {
      events.push(fields);
    },
    error(fields: Record<string, unknown>) {
      events.push(fields);
    },
  };
  const http = new LoggingScoutHttpPort(
    {
      async request() {
        return {
          status: 200,
          url: "https://careers.example.test/jobs",
          headers: { "set-cookie": "private-session", "x-result": "jobs" },
          body: "private job description",
        };
      },
    },
    logger,
  );

  await http.request({
    url: "https://careers.example.test/jobs?filter=engineering",
    context: { runId: "run-1", companyId: "company-1", page: 2, stage: "listing" },
    method: "POST",
    headers: { authorization: "Bearer secret", "x-filter": "engineering" },
    body: JSON.stringify({ filter: "engineering" }),
    timeoutMs: 100,
    maxResponseBytes: 1000,
  });

  expect(events.map((event) => event.event)).toEqual([
    "scout.http.request_started",
    "scout.http.request_completed",
  ]);
  expect(JSON.stringify(events)).toContain("engineering");
  expect(JSON.stringify(events)).toContain("private job description");
  const completed = events[1]!;
  expect(completed.requestId).toEqual(expect.any(String));
  expect(completed.context).toEqual({ runId: "run-1", companyId: "company-1", page: 2, stage: "listing" });
  expect(completed.responseStatus).toBe(200);
  expect(completed.responseContentType).toBeNull();
  expect(completed.responseBodyBytes).toBe(23);
  expect(completed.responseBodySha256).toEqual(expect.any(String));
  expect((completed.responseBodyPrefix as { value: string }).value).toBe(
    "private job description",
  );
  expect(JSON.stringify(events)).not.toContain("Bearer secret");
  expect(JSON.stringify(events)).not.toContain("private-session");
  expect((completed as { fullResponse?: unknown }).fullResponse).toBeUndefined();
});

test("full response logging is opt-in and still sanitizes response content", async () => {
  const events: Array<Record<string, unknown>> = [];
  const http = new LoggingScoutHttpPort(
    {
      async request() {
        return {
          status: 200,
          url: "https://careers.example.test/jobs",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobs: ["private role"], access_token: "secret" }),
        };
      },
    },
    { info(fields) { events.push(fields); }, error(fields) { events.push(fields); } },
    { logFullResponses: true },
  );

  await http.request({
    url: "https://careers.example.test/jobs",
    method: "GET",
    timeoutMs: 100,
    maxResponseBytes: 1000,
  });

  const completed = events[1]!;
  expect((completed as { fullResponse: { value: string } }).fullResponse.value).toContain(
    '"jobs":["private role"]',
  );
  expect(JSON.stringify(completed)).not.toContain("secret");
});

test("large log values are bounded and explicitly marked", () => {
  expect(boundedLogValue("abcdef", 3)).toEqual({
    value: "abc",
    truncated: true,
    originalLength: 6,
  });
});

test("secret header matching is narrow", () => {
  expect(
    sanitizedHeaders({
      cookie: "secret",
      authorization: "secret",
      "x-company-description": "private but useful",
    }),
  ).toEqual({
    cookie: "[REDACTED]",
    authorization: "[REDACTED]",
    "x-company-description": "private but useful",
  });
});

test("authentication material is removed from JSON bodies and URLs", () => {
  expect(
    sanitizedLogText(
      JSON.stringify({ jobs: ["private role"], access_token: "secret" }),
    ),
  ).toContain('"access_token":"[REDACTED]"');
  expect(
    sanitizedLogText("https://example.test/jobs?token=secret&team=engineering"),
  ).toBe(
    "https://example.test/jobs?token=[REDACTED]&team=engineering",
  );
  expect(
    sanitizedLogText(
      '<script>window.bootstrap = {"csrf_token":"secret"}</script>',
    ),
  ).not.toContain("secret");
  expect(
    sanitizedLogText(
      '<form><input name="password" value="secret"><input name="role" value="private"></form>',
    ),
  ).not.toContain('value="secret"');
  expect(sanitizedLogText("<input name=password value=secret>")).not.toContain(
    "value=secret",
  );
  expect(sanitizedLogText("refresh_token=secret")).not.toContain("secret");
});

test("logging failures do not change application outcomes", () => {
  expect(() =>
    safeScoutLog(
      {
        info() {
          throw new Error("disk full");
        },
        error() {
          throw new Error("disk full");
        },
      },
      "info",
      { event: "scout.test" },
      "test",
    ),
  ).not.toThrow();
});
