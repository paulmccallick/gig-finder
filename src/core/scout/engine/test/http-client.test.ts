import { expect, test } from "bun:test";
import { BoundedFetchHttpPort } from "../../sourcing/ports";

test("Scout identifies requests and preserves explicit client headers", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      return Response.json(Object.fromEntries(request.headers.entries()));
    },
  });
  try {
    const client = new BoundedFetchHttpPort();
    for (const explicitName of [null, "User-Agent", "user-agent", "USER-AGENT"]) {
      const response = await client.request({
        url: server.url.toString(),
        method: "GET",
        headers: {
          accept: "application/json",
          ...(explicitName ? { [explicitName]: "SyntheticSource/2.0" } : {}),
        },
        timeoutMs: 1000,
        maxResponseBytes: 4096,
      });
      const received = JSON.parse(response.body);
      expect(received["user-agent"]).toBe(
        explicitName ? "SyntheticSource/2.0" : "GigFinder/1.0",
      );
      expect(received.accept).toBe("application/json");
      expect(response.headers["content-type"]).toContain("application/json");
    }
  } finally {
    await server.stop(true);
  }
});
