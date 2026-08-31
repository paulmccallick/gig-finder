import { Database } from "bun:sqlite";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EncodedDescriptionSelectionReport {
  generatedAt:string;
  complete:boolean;
  selected:Array<{positionId:string;state:string;origin:string|null;linkedGigId:string|null;company:string}>;
  excluded:Record<string,number>;
  unresolved:Array<{positionId:string;code:"missing_artifact"|"unreadable_artifact"}>;
}

interface SelectionInput {
  databasePath:string;
  descriptionsPath:string;
  outputPath:string;
  generatedAt?:string;
}

interface SelectionRow {
  positionId:string;
  company:string;
  state:string|null;
  origin:string|null;
  linkedGigId:string|null;
  completedPromotionGigId:string|null;
  filePath:string|null;
}

const repositoryRoot=path.resolve(import.meta.dir,"..");
const allowedOutputRoot=path.join(repositoryRoot,"tmp");
const maxArtifactBytes=1_000_000;
const encodedStructuralTag=/(?:&(?:amp;)?(?:lt|#0*60|#x0*3c);)\s*\/?\s*(?:div|p|ul|ol|li|h[1-6]|a|strong|em)\b[\s\S]{0,256}?(?:&(?:amp;)?(?:gt|#0*62|#x0*3e);)/i;

function increment(counts:Record<string,number>,key:string){counts[key]=(counts[key]??0)+1;}

function isEligible(row:SelectionRow){
  if(row.state==="needs_user_review")return true;
  if(row.state==="irrelevant"&&row.origin==="agent")return true;
  return row.state==="promoted"&&row.linkedGigId!==null&&row.completedPromotionGigId===row.linkedGigId;
}

async function inspectArtifact(descriptionsRoot:string,filePath:string|null):Promise<"encoded"|"clean"|"missing"|"unreadable">{
  if(!filePath)return"missing";
  const root=path.resolve(descriptionsRoot);
  const artifact=path.resolve(root,filePath);
  if(!artifact.startsWith(`${root}${path.sep}`))return"unreadable";
  try{
    const metadata=await stat(artifact);
    if(!metadata.isFile()||metadata.size>maxArtifactBytes)return"unreadable";
    const markdown=await readFile(artifact,"utf8");
    return encodedStructuralTag.test(markdown)?"encoded":"clean";
  }catch(error){return error instanceof Error&&"code" in error&&error.code==="ENOENT"?"missing":"unreadable";}
}

export async function writeEncodedDescriptionSelectionReport(input:SelectionInput):Promise<EncodedDescriptionSelectionReport>{
  const output=path.resolve(input.outputPath);
  if(!output.startsWith(`${allowedOutputRoot}${path.sep}`))throw new Error("The encoded-description selection report must be written beneath repository-local tmp/.");
  const database=new Database(path.resolve(input.databasePath),{readonly:true,strict:true});
  try{
    const rows=database.query(`
      SELECT
        p.id positionId,
        c.name company,
        s.state,
        decision.origin,
        s.linked_gig_id linkedGigId,
        promotion.gig_id completedPromotionGigId,
        artifact.file_path filePath
      FROM scout_positions p
      JOIN scout_companies c ON c.id=p.company_id
      LEFT JOIN scout_position_states s ON s.position_id=p.id
      LEFT JOIN scout_position_decisions decision ON decision.id=s.current_decision_id
      LEFT JOIN scout_position_descriptions description ON description.id=(
        SELECT latest.id
        FROM scout_position_descriptions latest
        WHERE latest.position_id=p.id
        ORDER BY latest.created_at DESC,latest.id DESC
        LIMIT 1
      )
      LEFT JOIN scout_description_artifacts artifact ON artifact.id=description.artifact_id
      LEFT JOIN scout_position_promotions promotion
        ON promotion.position_id=p.id
        AND promotion.status='completed'
        AND promotion.gig_id=s.linked_gig_id
      ORDER BY p.id
    `).all() as SelectionRow[];
    const selected:EncodedDescriptionSelectionReport["selected"]=[];
    const excluded:Record<string,number>={};
    const unresolved:EncodedDescriptionSelectionReport["unresolved"]=[];
    for(const row of rows){
      if(!isEligible(row)){increment(excluded,"ineligible_state_or_origin");continue;}
      const artifact=await inspectArtifact(input.descriptionsPath,row.filePath);
      if(artifact==="missing"){unresolved.push({positionId:row.positionId,code:"missing_artifact"});continue;}
      if(artifact==="unreadable"){unresolved.push({positionId:row.positionId,code:"unreadable_artifact"});continue;}
      if(artifact==="clean"){increment(excluded,"encoded_tag_not_found");continue;}
      selected.push({positionId:row.positionId,state:row.state!,origin:row.origin,linkedGigId:row.linkedGigId,company:row.company.slice(0,200)});
    }
    const report:EncodedDescriptionSelectionReport={generatedAt:input.generatedAt??new Date().toISOString(),complete:unresolved.length===0,selected,excluded,unresolved};
    await mkdir(path.dirname(output),{recursive:true});
    await writeFile(output,`${JSON.stringify(report,null,2)}\n`,{encoding:"utf8",mode:0o600});
    return report;
  }finally{database.close();}
}

function argument(name:string){const index=Bun.argv.indexOf(name);return index<0?undefined:Bun.argv[index+1];}

if(import.meta.main){
  const databasePath=argument("--database");
  const descriptionsPath=argument("--descriptions");
  const outputPath=argument("--output");
  if(!databasePath||!descriptionsPath||!outputPath)throw new Error("Usage: bun run scout:encoded-description-selection -- --database <path> --descriptions <path> --output <ignored-json>");
  const report=await writeEncodedDescriptionSelectionReport({databasePath,descriptionsPath,outputPath});
  console.log(JSON.stringify({complete:report.complete,selected:report.selected.length,excluded:Object.values(report.excluded).reduce((total,count)=>total+count,0),unresolved:report.unresolved.length}));
}
