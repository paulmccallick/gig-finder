import type { GigScoutHttpPort } from "./ports";
const maxDescriptionCharacters = 200_000;
export function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const markdownish=/<[a-z][\s\S]*>/i.test(value)?value
    .replace(/<\s*br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|section|article|h[1-6]|ul|ol)>/gi,"\n\n")
    .replace(/<li\b[^>]*>/gi,"\n- ").replace(/<\/li>/gi,"").replace(/<[^>]*>/g," ")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'"):value;
  const normalized = markdownish.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g,"\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized ? normalized.slice(0, maxDescriptionCharacters) : null;
}

export async function retrieveOfficialDescription(url:string,http:GigScoutHttpPort,signal?:AbortSignal):Promise<string>{
  const parsed=new URL(url);
  if(parsed.protocol!=="https:")throw new Error("Official description URLs must use HTTPS.");
  signal?.throwIfAborted();
  const response=await http.request({url:parsed.toString(),method:"GET",headers:{accept:"text/html, text/plain;q=0.9"},timeoutMs:15_000,maxResponseBytes:1_000_000,signal});
  if(response.status<200||response.status>=300)throw new Error(`description_http_${response.status}`);
  const description=normalizeDescription(response.body);
  if(!description)throw new Error("description_empty");
  return description;
}
