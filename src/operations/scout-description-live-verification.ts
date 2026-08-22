import { Database } from "bun:sqlite";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { scanCompany } from "../core/scout/engine/scan-company";
import { acquirePlannedDescription, resolveDetailDescriptionPlan } from "../core/scout/sourcing/detail-descriptions";
import { BoundedFetchHttpPort } from "../core/scout/sourcing/ports";
import { sourceConfigurationSchema, type SourceConfiguration } from "../core/scout/sourcing/contracts";
import { scoutTemplateCatalog } from "./scout-template-catalog";

const databasePath=process.env.GIG_FINDER_DATABASE?.trim();
const reportPath=process.env.GIG_FINDER_SCOUT_DESCRIPTION_REPORT?.trim();
const overlayPath=process.env.GIG_FINDER_SCOUT_DESCRIPTION_OVERLAYS?.trim();
const companyFilter=new Set((process.env.GIG_FINDER_SCOUT_DESCRIPTION_COMPANIES??"").split(",").map(value=>value.trim()).filter(Boolean));
if(!databasePath)throw new Error("GIG_FINDER_DATABASE is required.");
if(!reportPath)throw new Error("GIG_FINDER_SCOUT_DESCRIPTION_REPORT is required.");
const repositoryRoot=path.resolve(import.meta.dir,"../..");
const allowedReportRoot=path.join(repositoryRoot,"tmp");
const resolvedReport=path.resolve(reportPath);
if(!resolvedReport.startsWith(`${allowedReportRoot}${path.sep}`))throw new Error("The live verification report must be written beneath repository-local tmp/.");

const database=new Database(databasePath,{readonly:true,strict:true});
const http=new BoundedFetchHttpPort();
const reports:Array<Record<string,unknown>>=[];
const overlays=overlayPath?JSON.parse(await readFile(path.resolve(overlayPath),"utf8")) as Record<string,unknown>:{};
const templateOverlays=(overlays.$templates??{}) as Record<string,Record<string,unknown>>;
try{const prior=JSON.parse(await readFile(resolvedReport,"utf8")) as {complete?:unknown;reports?:unknown};if(prior.complete!==true&&Array.isArray(prior.reports))reports.push(...prior.reports.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"));}catch(error){if(!(error instanceof Error&&"code" in error&&error.code==="ENOENT"))throw error;}
const snapshot=async(complete:boolean)=>{const counts=Object.fromEntries([...new Set(reports.map(report=>String(report.outcome)))].sort().map(outcome=>[outcome,reports.filter(report=>report.outcome===outcome).length]));const result={verifiedAt:new Date().toISOString(),databaseMode:"read-only",complete,companyCount:new Set(reports.map(report=>report.company)).size,sourceCount:reports.length,counts,reports};await mkdir(path.dirname(resolvedReport),{recursive:true});await writeFile(resolvedReport,`${JSON.stringify(result,null,2)}\n`,{encoding:"utf8",mode:0o600});return result;};
try{
  const allRows=database.query(`SELECT c.id companyId,c.name company,c.current_configuration_id configurationVersionId,s.source_key sourceKey,s.settings_json settings FROM scout_companies c JOIN scout_company_configuration_sources s ON s.company_configuration_id=c.current_configuration_id AND s.active=1 WHERE c.active=1 ORDER BY c.name,s.source_key`).all() as Array<{companyId:string;company:string;configurationVersionId:string;sourceKey:string;settings:string}>;
  const completedSources=new Set(reports.map(report=>`${String(report.company)}\0${String(report.sourceKey)}`));
  const selectedRows=companyFilter.size?allRows.filter(row=>companyFilter.has(row.company)):allRows;
  const rows=selectedRows.filter(row=>!completedSources.has(`${row.company}\0${row.sourceKey}`));
  for(const row of rows){
    const configured=JSON.parse(row.settings) as Record<string,unknown>;
    const configuredTemplate=configured.template as {id?:unknown;version?:unknown}|undefined;
    const templateKey=configuredTemplate&&typeof configuredTemplate.id==="string"&&typeof configuredTemplate.version==="number"?`${configuredTemplate.id}@${configuredTemplate.version}`:null;
    const source=sourceConfigurationSchema.parse({...configured,...(templateKey?templateOverlays[templateKey]:undefined),...(overlays[row.company] as Record<string,unknown>|undefined)}) as SourceConfiguration;
    const template="template" in source?`${source.template.id}@${source.template.version}`:"custom";
    let selectedSource=source.url;
    try{
      const result=await scanCompany({companyId:row.companyId,configurationVersionId:row.configurationVersionId,sources:[source],searchProfile:{terms:[],locations:[]}},{http,templates:scoutTemplateCatalog,policy:{maxPages:2,maxRequests:20,maxRecords:200,sourceDurationMs:60_000,retries:1}});
      const position=result.positions[0];
      if(!position){reports.push({company:row.company,sourceKey:row.sourceKey,source:source.url,template,strategy:null,outcome:result.sources[0]?.status==="succeeded_empty_verified"?"no_current_position":"search_blocked",failureCode:result.sources[0]?.attempts.at(-1)?.failure?.code??result.sources[0]?.status});continue;}
      if(position.description){reports.push({company:row.company,sourceKey:row.sourceKey,source:position.canonicalUrl,template,strategy:"search-result-v1",outcome:"description_succeeded",failureCode:null});continue;}
      selectedSource=position.canonicalUrl;
      const plan=resolveDetailDescriptionPlan(source,{id:position.externalId,title:position.title,url:position.canonicalUrl},scoutTemplateCatalog);
      if(!plan)throw new Error("description_acquisition_not_configured");
      await acquirePlannedDescription(plan,{id:position.externalId,title:position.title},http);
      reports.push({company:row.company,sourceKey:row.sourceKey,source:position.canonicalUrl,template,strategy:plan.strategyVersion,outcome:"description_succeeded",failureCode:null});
    }catch(error){reports.push({company:row.company,sourceKey:row.sourceKey,source:selectedSource,template,strategy:null,outcome:"description_failed",failureCode:error instanceof Error?error.message.slice(0,100):"unknown_error"});}
    finally{await snapshot(false);}
  }
  const result=await snapshot(true);
  console.log(JSON.stringify({report:resolvedReport,companyCount:result.companyCount,sourceCount:result.sourceCount,counts:result.counts}));
}finally{database.close();}
