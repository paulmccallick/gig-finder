import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactPort, ArtifactVerification } from "../../core/src/ports";

const idPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safe=(value:string)=>{if(!idPattern.test(value))throw new Error(`Invalid artifact id: ${value}`);return value};
export class LocalArtifactStore implements ArtifactPort{
  constructor(private readonly root:string){}
  personProfile(personId:string){return readFile(path.join(this.root,"people",safe(personId),"profile.md"),"utf8")}
  jobDescription(jobId:string){return readFile(path.join(this.root,"jobs",safe(jobId),"job-description.md"),"utf8")}
  async interviewPrep(jobId:string){const directory=path.join(this.root,"jobs",safe(jobId),"interview-prep");const names=(await readdir(directory)).filter(name=>name.endsWith(".md")).sort();return Promise.all(names.map(async name=>({name,content:await readFile(path.join(directory,name),"utf8")})))}
  personProfileExists(personId:string){return exists(path.join(this.root,"people",safe(personId),"profile.md"))}
  jobDescriptionExists(jobId:string){return exists(path.join(this.root,"jobs",safe(jobId),"job-description.md"))}
  async interviewPrepExists(jobId:string){return (await readdir(path.join(this.root,"jobs",safe(jobId),"interview-prep")).catch(()=>[])).some(name=>name.endsWith(".md"))}
  async verify(expectations:{people:{id:string;hasLocalProfile:boolean}[];jobs:{id:string;hasJobDescription:boolean;hasInterviewPrep:boolean}[]}):Promise<ArtifactVerification>{
    const errors:string[]=[];const expected=new Set<string>();
    for(const person of expectations.people){const relative=`people/${safe(person.id)}/profile.md`;if(person.hasLocalProfile)expected.add(relative);if(person.hasLocalProfile!==await exists(path.join(this.root,relative)))errors.push(`${person.id}: has_local_profile does not match ${relative}`)}
    for(const job of expectations.jobs){const description=`jobs/${safe(job.id)}/job-description.md`;if(job.hasJobDescription)expected.add(description);if(job.hasJobDescription!==await exists(path.join(this.root,description)))errors.push(`${job.id}: has_job_description does not match ${description}`);const prepRoot=path.join(this.root,"jobs",job.id,"interview-prep");const prep=(await readdir(prepRoot).catch(()=>[])).filter(name=>name.endsWith(".md"));for(const name of prep)expected.add(`jobs/${job.id}/interview-prep/${name}`);if(job.hasInterviewPrep!==(prep.length>0))errors.push(`${job.id}: has_interview_prep does not match its prep directory`)}
    const actual=await markdownFiles(this.root);return{ok:errors.length===0&&actual.every(file=>expected.has(file)),errors,unregistered:actual.filter(file=>!expected.has(file))};
  }
}
async function exists(file:string){try{await readFile(file);return true}catch{return false}}
async function markdownFiles(root:string,prefix=""):Promise<string[]>{const directory=path.join(root,prefix);const entries=await readdir(directory,{withFileTypes:true}).catch(()=>[]);const nested=await Promise.all(entries.map(entry=>entry.isDirectory()?markdownFiles(root,path.join(prefix,entry.name)):entry.name.endsWith(".md")?[path.join(prefix,entry.name)]:[]));return nested.flat().sort()}
