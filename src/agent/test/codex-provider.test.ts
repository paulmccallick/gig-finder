import { expect, test } from "bun:test";
import { createCodexLanguageModel } from "../codex-provider";

test.each(["gpt-6-astra", "gpt-5.6-sol"] as const)(
  "%s sends the intended reasoning settings through the Responses adapter",
  async modelId => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        body = await request.json() as Record<string, unknown>;
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    try {
      const model = await createCodexLanguageModel(modelId, {
        smokeBaseURL: `http://127.0.0.1:${server.port}`,
      });
      const response = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        providerOptions: { openai: { store: false, reasoningSummary: "auto" } },
      });
      await response.stream.cancel();
      expect(body.model).toBe(modelId);
      expect(body.store).toBe(false);
      expect(body.reasoning).toEqual(modelId === "gpt-6-astra"
        ? { effort: "medium", summary: "auto" }
        : { summary: "auto" });
    } finally {
      await server.stop(true);
    }
  },
);
