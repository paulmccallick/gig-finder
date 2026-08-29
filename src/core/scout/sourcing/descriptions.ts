import TurndownService from "turndown";
import { decode } from "html-entities";
import type { GigScoutHttpPort } from "./ports";

export type DescriptionContentFormat = "auto" | "html" | "plain-text";
export type DescriptionContentEncoding = "none" | "html-entities";

export const scoutDescriptionConverterVersion="html-to-markdown-v2";
const maxDescriptionCharacters=200_000;
const sha256 = async (value: string) =>
 Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");

export function descriptionToMarkdown(value:string,mediaType?:string|null):string|null {
 if(!value.trim())return null;
 const html=mediaType?.includes("html")??/<[a-z][\s\S]*>/i.test(value);
 if(!html){if(value.length>maxDescriptionCharacters)throw new Error("description_too_large");return value;}
 const converter=new TurndownService({headingStyle:"atx",bulletListMarker:"-",emDelimiter:"*",strongDelimiter:"**",codeBlockStyle:"fenced"});
 const markdown=converter.turndown(value);
 if(markdown.length>maxDescriptionCharacters)throw new Error("description_too_large");
 return markdown;
}

export function normalizeDescription(value:unknown):string|null {return typeof value==="string"?descriptionToMarkdown(value):null;}

function decodeConfiguredHtml(value: string, encoding: DescriptionContentEncoding) {
 if (encoding !== "html-entities") return value;
 let decoded = value;
 for (let pass = 0; pass < 2; pass += 1) {
  const next = decode(decoded, { level: "html5", scope: "body" });
  if (next === decoded) break;
  decoded = next;
 }
 return decoded;
}

export function normalizeExtractedDescription(
 value: unknown,
 options: Partial<{
  contentFormat: DescriptionContentFormat;
  contentEncoding: DescriptionContentEncoding;
 }> = {},
): string | null {
 if (typeof value !== "string") return null;
 const contentFormat = options.contentFormat ?? "auto";
 const contentEncoding = options.contentEncoding ?? "none";
 if (contentEncoding === "html-entities" && contentFormat !== "html")
  throw new Error("description_content_encoding_invalid");
 if (contentFormat === "plain-text") {
  if (value.length > maxDescriptionCharacters) throw new Error("description_too_large");
  return value;
 }
 const normalized = decodeConfiguredHtml(value, contentEncoding);
 const usesHtml = contentFormat === "html" || /<[a-z][\s\S]*>/i.test(normalized);
 const mediaType = usesHtml
  ? "text/html"
  : "text/plain";
 return descriptionToMarkdown(normalized, mediaType);
}

export async function retrieveOfficialDescription(url:string,http:GigScoutHttpPort,signal?:AbortSignal):Promise<{markdown:string;sourceContentHash:string;sourceUrl:string;retrievedAt:string;converterVersion:string}> {
 const parsed=new URL(url);if(parsed.protocol!=="https:")throw new Error("Official description URLs must use HTTPS.");signal?.throwIfAborted();
 const response=await http.request({url:parsed.toString(),method:"GET",headers:{accept:"text/html, text/markdown;q=0.95, text/plain;q=0.9"},timeoutMs:15_000,maxResponseBytes:1_000_000,redirect:"error",signal});
 if(response.status<200||response.status>=300)throw new Error(`description_http_${response.status}`);
 const contentType=response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()??"text/html";
 if(!["text/html","text/plain","text/markdown","application/xhtml+xml"].includes(contentType))throw new Error("description_content_type_invalid");
 const markdown=descriptionToMarkdown(response.body,contentType);if(!markdown)throw new Error("description_empty");
 return{markdown,sourceContentHash:await sha256(response.body),sourceUrl:response.url,retrievedAt:new Date().toISOString(),converterVersion:scoutDescriptionConverterVersion};
}
