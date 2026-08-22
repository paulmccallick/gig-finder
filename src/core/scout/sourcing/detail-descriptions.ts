import { atPath } from "./extractors/json";
import type { GigScoutHttpPort } from "./ports";
import type { PlannedRequest } from "./source-plan";
import { descriptionToMarkdown, scoutDescriptionConverterVersion } from "./descriptions";
import type { SourceConfiguration } from "./contracts";
import type { TemplateResolver } from "./adapters/templates/definitions";
import { planReusableDetailRequest } from "./adapters/templates/request";
import { planInlineDetailRequest } from "./source-plan";

export interface DetailDescriptionPlan {
  request: PlannedRequest;
  response: "json" | "html";
  descriptionPath?: string;
  extractor?: { type:"dom"; selector:string; titleSelector?:string; idSelector?:string } | { type:"json-ld" };
  identity?: { titlePath?:string; idPath?:string };
  strategyVersion: string;
  template?: { id:string; version:number };
}

const sha256 = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
const normalizeIdentity = (value:unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim().toLowerCase() : "";
const comparableIdentity=(value:unknown)=>normalizeIdentity(value).normalize("NFKC").replaceAll("&amp;","&").replaceAll("&quot;",'"').replace(/[^\p{L}\p{N}]+/gu," ").trim();

export function resolveDetailDescriptionPlan(source:SourceConfiguration,position:{id:string|null;title:string;url:string},templates?:TemplateResolver):DetailDescriptionPlan|null{
  if("template" in source){if(!templates)throw new Error("Scout template catalog is unavailable.");const definition=templates.resolve(source.template);if(!definition.detailDescription)return null;const request=planReusableDetailRequest(source,definition,position);if(!request)return null;return{request,response:definition.detailDescription.response,descriptionPath:definition.detailDescription.descriptionPath,extractor:definition.detailDescription.extractor,identity:definition.detailDescription.identity,strategyVersion:`${definition.detailDescription.response}-${definition.detailDescription.extractor?.type??"field"}-v1`,template:source.template};}
  const detail=source.detailDescription;if(!detail)return null;
  if(detail.response==="json")return{request:planInlineDetailRequest({sourceUrl:source.url,urlTemplate:detail.request.urlTemplate,method:detail.request.method,headers:detail.request.headers,body:detail.request.body},position),response:"json",descriptionPath:detail.descriptionPath,identity:detail.identity,strategyVersion:"json-field-v1"};
  return{request:planInlineDetailRequest({sourceUrl:source.url,urlTemplate:detail.urlTemplate,method:"GET",headers:{accept:"text/html, application/xhtml+xml"}},position),response:"html",extractor:detail.extractor,strategyVersion:`html-${detail.extractor.type}-v1`};
}

async function htmlSelection(body:string, selector:string) {
  let matches=0, content="";
  let active=0;
  const voidTags=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
  const rewriter=new HTMLRewriter().on(selector,{element(element){matches++;active++;const tag=element.tagName;content+=`<${tag}>`;element.onEndTag(()=>{content+=`</${tag}>`;active--;});},text(text){if(active)content+=text.text;}}).on(`${selector} *`,{element(element){if(!active)return;const tag=element.tagName;const href=element.getAttribute("href");content+=`<${tag}${href?` href="${href.replaceAll('"','&quot;')}"`:""}>`;if(!voidTags.has(tag))element.onEndTag(()=>{content+=`</${tag}>`;});}});
  await rewriter.transform(new Response(body)).text();
  if(matches===0)throw new Error("description_empty");
  if(matches>1)throw new Error("description_ambiguous");
  return content;
}

async function htmlText(body:string,selector:string){let matches=0,value="";const rewriter=new HTMLRewriter().on(selector,{element(){matches++;},text(text){value+=text.text;}});await rewriter.transform(new Response(body)).text();if(matches!==1)throw new Error(matches?"description_ambiguous":"description_identity_mismatch");return normalizeIdentity(value);}
const sameTitle=(left:string,right:string)=>{const a=comparableIdentity(left),b=comparableIdentity(right);return a===b||(a.length>=10&&b.includes(a))||(b.length>=10&&a.includes(b));};

async function jsonLdSelection(body:string, position:{id:string|null;title:string}) {
  const scripts:string[]=[];let active=-1;
  const rewriter=new HTMLRewriter().on('script[type="application/ld+json"]',{element(element){active=scripts.push("")-1;element.onEndTag(()=>{active=-1;});},text(text){if(active>=0)scripts[active]+=text.text;}});
  await rewriter.transform(new Response(body)).text();
  const postings:Record<string,unknown>[]=[];
  const collect=(value:unknown):void=>{if(Array.isArray(value)){value.forEach(collect);return;}if(!value||typeof value!=="object")return;const record=value as Record<string,unknown>;const types=Array.isArray(record["@type"])?record["@type"]:[record["@type"]];if(types.includes("JobPosting"))postings.push(record);if(Array.isArray(record["@graph"]))collect(record["@graph"]);};
  for(const script of scripts){try{collect(JSON.parse(script));}catch{continue;}}
  const matching=postings.filter(posting=>{const identifier=posting.identifier;const id=typeof identifier==="object"&&identifier?comparableIdentity((identifier as Record<string,unknown>).value):comparableIdentity(identifier);const title=normalizeIdentity(posting.title);return Boolean((position.id&&id&&comparableIdentity(position.id)===id)||(title&&sameTitle(title,position.title)));});
  if(matching.length===0)throw new Error("description_identity_mismatch");
  if(matching.length>1)throw new Error("description_ambiguous");
  return matching[0]!.description;
}

export async function acquirePlannedDescription(plan:DetailDescriptionPlan,position:{id:string|null;title:string},http:GigScoutHttpPort,signal?:AbortSignal){
  if(new URL(plan.request.url).protocol!=="https:")throw new Error("Official description URLs must use HTTPS.");
  const response=await http.request({...plan.request,timeoutMs:15_000,maxResponseBytes:1_000_000,redirect:"error",signal});
  if(response.status<200||response.status>=300)throw new Error(`description_http_${response.status}`);
  const contentType=response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()??"";
  let extracted:unknown;
  if(plan.response==="json"){
    if(!contentType.includes("json"))throw new Error("description_content_type_invalid");
    const payload=JSON.parse(response.body);
    if(plan.identity?.idPath&&!position.id)throw new Error("description_identity_input_missing");
    if(plan.identity?.idPath&&normalizeIdentity(atPath(payload,plan.identity.idPath))!==normalizeIdentity(position.id))throw new Error("description_identity_mismatch");
    if(plan.identity?.titlePath&&normalizeIdentity(atPath(payload,plan.identity.titlePath))!==normalizeIdentity(position.title))throw new Error("description_identity_mismatch");
    extracted=atPath(payload,plan.descriptionPath!);
    if(Array.isArray(extracted)&&extracted.every(value=>typeof value==="string"))extracted=extracted.join("\n\n");
  }else{
    if(!contentType.includes("html")&&!contentType.includes("xhtml"))throw new Error("description_content_type_invalid");
    if(plan.extractor?.type==="dom"){
      if(plan.extractor.idSelector&&!position.id)throw new Error("description_identity_input_missing");
      if(plan.extractor.idSelector&&await htmlText(response.body,plan.extractor.idSelector)!==normalizeIdentity(position.id))throw new Error("description_identity_mismatch");
      if(plan.extractor.titleSelector&&!sameTitle(await htmlText(response.body,plan.extractor.titleSelector),position.title))throw new Error("description_identity_mismatch");
      extracted=await htmlSelection(response.body,plan.extractor.selector);
    }else extracted=await jsonLdSelection(response.body,position);
  }
  if(typeof extracted!=="string"||!extracted.trim())throw new Error("description_empty");
  const markdown=descriptionToMarkdown(extracted,/<[a-z][\s\S]*>/i.test(extracted)?"text/html":"text/plain");
  if(!markdown)throw new Error("description_empty");
  return {markdown,sourceContentHash:await sha256(response.body),extractedContentHash:await sha256(extracted),sourceUrl:response.url,retrievedAt:new Date().toISOString(),converterVersion:scoutDescriptionConverterVersion,strategyVersion:plan.strategyVersion,template:plan.template};
}
