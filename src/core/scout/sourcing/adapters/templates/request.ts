import type { PlannedRequest } from "../../source-plan";
import type { ReusableJsonDefinition } from "./definitions";
import type { ReusableJsonTemplateSource } from "./types";

type TemplateContext = {
  configured: URL;
  source: ReusableJsonTemplateSource;
  page: number;
  pageSize: number;
  term: string;
};

function templateValue(token: string, context: TemplateContext): string | null {
  const [key = "", fallback = ""] = token.split("|");
  if (key === "origin") return context.configured.origin;
  if (key === "term") return context.term;
  if (key === "page") return String(context.page);
  if (key === "pageZero") return String(context.page - 1);
  if (key === "offset") return String((context.page - 1) * context.pageSize);
  if (key.startsWith("path.")) {
    const index = Number(key.slice("path.".length));
    return context.configured.pathname.split("/").filter(Boolean)[index] ?? fallback;
  }
  if (key.startsWith("pathAfter.")) {
    const parts = context.configured.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf(key.slice("pathAfter.".length));
    return (marker >= 0 ? parts[marker + 1] : undefined) ?? fallback;
  }
  if (key.startsWith("query."))
    return context.configured.searchParams.get(key.slice("query.".length)) ?? fallback;
  if (key.startsWith("queryHost.")) {
    const value = context.configured.searchParams.get(
      key.slice("queryHost.".length),
    );
    if (!value) return fallback;
    try {
      return new URL(value).hostname;
    } catch {
      return fallback;
    }
  }
  if (key.startsWith("hashQuery."))
    return (
      new URLSearchParams(context.configured.hash.slice(1)).get(
        key.slice("hashQuery.".length),
      ) ?? fallback
    );
  if (key.startsWith("variable."))
    return context.source.variables[
      key.slice("variable.".length) as keyof typeof context.source.variables
    ] ?? fallback;
  if (key.startsWith("override."))
    return context.source.overrides[
      key.slice("override.".length) as keyof typeof context.source.overrides
    ] ?? fallback;
  return null;
}

function resolveTemplate(template: string, context: TemplateContext) {
  return template.replace(/\{([^}]+)\}/g, (match, token: string) => {
    const value = templateValue(token, context);
    return value === null ? match : value;
  });
}

function resolveBodyValue(value: unknown, context: TemplateContext): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{(page|pageZero|offset)\}$/);
    if (exact) return Number(templateValue(exact[1]!, context));
    return resolveTemplate(value, context);
  }
  if (Array.isArray(value))
    return value.map((item) => resolveBodyValue(item, context));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveBodyValue(item, context),
      ]),
    );
  return value;
}

export function planReusableJsonRequest(
  source: ReusableJsonTemplateSource,
  page: number,
  term: string,
  definition: ReusableJsonDefinition,
): PlannedRequest | null {
  if (!definition.request) return null;
  const configured = new URL(source.url);
  const context = {
    configured,
    source,
    page,
    pageSize: definition.pageSize,
    term,
  };
  const endpoint = definition.request.endpoint;
  let url: URL;
  if (
    endpoint.canonicalHost &&
    configured.hostname !== endpoint.canonicalHost &&
    endpoint.publicUrlTemplate
  ) {
    url = new URL(resolveTemplate(endpoint.publicUrlTemplate, context));
  } else if (endpoint.mode === "origin") {
    url = new URL(
      resolveTemplate(endpoint.path ?? "/", context),
      configured.origin,
    );
  } else if (
    endpoint.configuredPathIncludes &&
    !configured.pathname.includes(endpoint.configuredPathIncludes)
  ) {
    url = new URL(endpoint.publicPath ?? "/", configured.origin);
  } else {
    url = new URL(configured);
  }
  if (endpoint.clearQuery) url.search = "";
  for (const key of endpoint.removeQuery) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(definition.request.query))
    if (resolveTemplate(value, context))
      url.searchParams.set(key, resolveTemplate(value, context));
  const body = definition.request.body
    ? JSON.stringify(resolveBodyValue(definition.request.body, context))
    : undefined;
  const headers = Object.fromEntries(
    Object.entries(definition.request.headers).map(([key, value]) => [
      key,
      resolveTemplate(value, context),
    ]),
  );
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type"))
    headers["content-type"] = "application/json";
  return {
    url: url.toString(),
    method: definition.request.method,
    ...(body ? { body } : {}),
    headers,
  };
}
