import type { SourceConfiguration } from "./contracts";
export interface PlannedRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}
export function planInlineDetailRequest(input:{sourceUrl:string;urlTemplate:string;method:"GET"|"POST";headers:Record<string,string>;body?:Record<string,unknown>},position:{id:string|null;title:string;url:string}):PlannedRequest{
  const values={"source.origin":new URL(input.sourceUrl).origin,"position.id":position.id??"","position.title":position.title,"position.url":position.url};
  const replace=(value:string,encode:boolean)=>value.replace(/\{(source\.origin|position\.(?:id|title|url))\}/g,(_match,key:keyof typeof values)=>encode&&key!=="source.origin"&&key!=="position.url"?encodeURIComponent(values[key]):values[key]);
  const url=new URL(replace(input.urlTemplate,true));
  if(url.protocol!=="https:")throw new Error("Official description URLs must use HTTPS.");
  const resolveBody=(value:unknown):unknown=>typeof value==="string"?replace(value,false):Array.isArray(value)?value.map(resolveBody):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolveBody(item)])):value;
  return{url:url.toString(),method:input.method,headers:Object.fromEntries(Object.entries(input.headers).map(([key,value])=>[key,replace(value,false)])),...(input.body?{body:JSON.stringify(resolveBody(input.body))}:{})};
}
export function planSourceRequest(
  source: SourceConfiguration,
  page = 1,
): PlannedRequest {
  if (source.type === "json" && "template" in source)
    throw new Error("Reusable JSON sources use their template request planner.");
  const url = new URL(source.url);
  url.searchParams.set("page", String(page));
  return {
    url: url.toString(),
    method: source.type === "json" ? source.method : "GET",
    ...(source.type === "json" && source.method === "POST"
      ? { body: JSON.stringify({ ...(source.body ?? {}), page }) }
      : {}),
  };
}
