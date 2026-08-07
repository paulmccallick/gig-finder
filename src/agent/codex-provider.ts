import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import {
  defaultAgentModelId,
  parseAgentModelId,
  type AgentModelId,
} from "../core/application-settings";

interface CodexAuth {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface CodexJwtClaims {
  exp?: number;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

function decodeClaims(token: string): CodexJwtClaims {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Codex access token is not a JWT.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CodexJwtClaims;
}

async function loadCodexCredential() {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
  let auth: CodexAuth;
  try {
    auth = JSON.parse(await readFile(path.join(codexHome, "auth.json"), "utf8")) as CodexAuth;
  } catch {
    throw new Error("Codex authentication is unavailable. Run `codex login`.");
  }
  const accessToken = auth.tokens?.access_token;
  if (!accessToken) throw new Error("Codex authentication is unavailable. Run `codex login`.");
  const claims = decodeClaims(accessToken);
  const accountId = auth.tokens?.account_id
    ?? claims["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (!accountId) throw new Error("Codex authentication does not include a ChatGPT account.");
  if (claims.exp && claims.exp * 1000 <= Date.now() + 60_000) {
    throw new Error("Codex authentication has expired. Run `codex login`.");
  }
  return { accessToken, accountId };
}

export async function createCodexLanguageModel(
  modelId: AgentModelId = defaultAgentModelId,
  options: { smokeBaseURL?: string } = {},
) {
  const selectedModel = parseAgentModelId(modelId);
  if (options.smokeBaseURL) {
    const provider = createOpenAI({
      name: "codex-smoke",
      baseURL: options.smokeBaseURL,
      apiKey: "smoke-provider-does-not-use-authentication",
    });
    return provider.responses(selectedModel);
  }
  const credential = await loadCodexCredential();
  const codexFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${credential.accessToken}`);
    headers.set("chatgpt-account-id", credential.accountId);
    headers.set("OpenAI-Beta", "responses=experimental");
    headers.set("originator", "gig-finder-agent");
    headers.set("accept", "text/event-stream");
    headers.set("content-type", "application/json");
    return fetch(input, { ...init, headers });
  }) as typeof fetch;
  const provider = createOpenAI({
    name: "codex-subscription",
    baseURL: "https://chatgpt.com/backend-api/codex",
    apiKey: "managed-by-codex-provider",
    fetch: codexFetch,
  });
  return provider.responses(selectedModel);
}
