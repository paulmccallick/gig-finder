import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactPort, ArtifactVerification } from "../../core/src/ports";

const idPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safe=(value:string)=>{if(!idPattern.test(value))throw new Error(`Invalid artifact id: ${value}`);return value};
export class LocalArtifactStore implements ArtifactPort{
  constructor(private readonly root:string){}
  jobDescription(jobId:string){return readMarkdown(path.join(this.root,"jobs",safe(jobId),"job-description.md"))}
  async interviewPrep(jobId:string){const directory=path.join(this.root,"jobs",safe(jobId),"interview-prep");const names=(await markdownNames(directory)).sort();return Promise.all(names.map(async name=>({name,content:await readMarkdown(path.join(directory,name))})))}
  jobDescriptionExists(jobId:string){return exists(path.join(this.root,"jobs",safe(jobId),"job-description.md"))}
  async interviewPrepExists(jobId:string){return (await markdownNames(path.join(this.root,"jobs",safe(jobId),"interview-prep"))).length>0}
  async verify(expectations:{jobs:{id:string;hasJobDescription:boolean;hasInterviewPrep:boolean}[]}):Promise<ArtifactVerification>{
    const errors:string[]=[];const expected=new Set<string>();
    for(const job of expectations.jobs){const description=`jobs/${safe(job.id)}/job-description.md`;if(job.hasJobDescription)expected.add(description);if(job.hasJobDescription!==await exists(path.join(this.root,description)))errors.push(`${job.id}: has_job_description does not match ${description}`);const prepRoot=path.join(this.root,"jobs",job.id,"interview-prep");const prep=await markdownNames(prepRoot);for(const name of prep)expected.add(`jobs/${job.id}/interview-prep/${name}`);if(job.hasInterviewPrep!==(prep.length>0))errors.push(`${job.id}: has_interview_prep does not match its prep directory`)}
    const actual=await markdownFiles(this.root);return{ok:errors.length===0&&actual.every(file=>expected.has(file)),errors,unregistered:actual.filter(file=>!expected.has(file))};
  }
}
async function readMarkdown(file:string){const stats=await lstat(file);if(!stats.isFile())throw new Error(`Artifact is not a regular file: ${file}`);return readFile(file,"utf8")}
async function exists(file:string){try{return(await lstat(file)).isFile()}catch{return false}}
async function markdownNames(directory:string){const entries=await readdir(directory,{withFileTypes:true}).catch(()=>[]);return entries.filter(entry=>entry.isFile()&&entry.name.endsWith(".md")).map(entry=>entry.name)}
async function markdownFiles(root:string,prefix=""):Promise<string[]>{const directory=path.join(root,prefix);const entries=await readdir(directory,{withFileTypes:true}).catch(()=>[]);const nested=await Promise.all(entries.map(entry=>entry.isDirectory()?markdownFiles(root,path.join(prefix,entry.name)):entry.isFile()&&entry.name.endsWith(".md")?[path.join(prefix,entry.name)]:[]));return nested.flat().sort()}
