import type { SourceConfiguration } from "../contracts";
import { HtmlSourceAdapter } from "./html";
import { JsonSourceAdapter } from "./json";
import type { SourceAdapter } from "./types";
import type { TemplateResolver } from "./templates/definitions";

export const sourceAdapter = (
  source: SourceConfiguration,
  templates: TemplateResolver,
): SourceAdapter =>
  source.type === "html"
    ? new HtmlSourceAdapter()
    : new JsonSourceAdapter(templates);
