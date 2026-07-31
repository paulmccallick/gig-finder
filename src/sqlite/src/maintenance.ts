import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "./database";

const entityTables=[
  {entity:"job",live:"jobs",history:"job_history"},
  {entity:"person",live:"people",history:"person_history"},
  {entity:"networking",live:"networking_contacts",history:"networking_contact_history"},
  {entity:"job-person",live:"job_people",history:"job_people_history"},
  {entity:"task",live:"tasks",history:"task_history"},
  {entity:"meeting",live:"meetings",history:"meeting_history"},
  {entity:"meeting-participant",live:"meeting_participants",history:"meeting_participant_history"},
] as const;

export interface ValidationIssue { check:string; message:string }
export interface ValidationReport {
  ok:boolean;
  integrity:string;
  foreignKeyViolations:number;
  counts:Record<string,number>;
  issues:ValidationIssue[];
}
export interface BackupReport { path:string; bytes:number; sha256:string; validation:ValidationReport }
export interface BackupManifest {
  version:1;
  createdAt:string;
  databasePath:string;
  backup:BackupReport;
}
export interface DailyBackupResult {
  created:boolean;
  backup:BackupReport;
  pruned:string[];
}

export function validateDatabase(database:Database):ValidationReport {
  const issues:ValidationIssue[]=[];
  const integrityRows=database.query("PRAGMA integrity_check").all() as Record<string,unknown>[];
  const integrity=integrityRows.map((row)=>String(Object.values(row)[0])).join("; ");
  if(integrity!=="ok")issues.push({check:"integrity",message:integrity});
  const foreignKeys=database.query("PRAGMA foreign_key_check").all();
  if(foreignKeys.length)issues.push({check:"foreign_keys",message:`${foreignKeys.length} foreign-key violation(s)`});
  const counts:Record<string,number>={};
  for(const table of ["changes","business_events","event_sources",...entityTables.flatMap((item)=>[item.live,item.history])]){
    counts[table]=Number((database.query(`SELECT count(*) AS count FROM ${table}`).get() as {count:number}).count);
  }
  for(const {entity,live,history} of entityTables){
    const rows=database.query(`SELECT id, revision FROM ${live} ORDER BY id`).all() as {id:string;revision:number}[];
    for(const row of rows){
      const revisions=(database.query(`SELECT revision FROM ${history} WHERE id = ? ORDER BY revision`).all(row.id) as {revision:number}[]).map((item)=>item.revision);
      const expected=Array.from({length:Math.max(0,row.revision-1)},(_,index)=>index+1);
      if(JSON.stringify(revisions)!==JSON.stringify(expected))issues.push({check:"revision_chain",message:`${entity} ${row.id}: history [${revisions.join(",")}] does not precede live revision ${row.revision}`});
    }
  }
  return {ok:issues.length===0,integrity,foreignKeyViolations:foreignKeys.length,counts,issues};
}

export async function createVerifiedBackup(databasePath:string,outputPath:string):Promise<BackupReport>{
  if(await Bun.file(outputPath).exists())throw new Error(`Backup already exists: ${outputPath}`);
  const source=openDatabase(databasePath,{create:false});
  const temporary=`${outputPath}.tmp-${process.pid}-${Date.now()}`;
  try{
    source.exec("PRAGMA wal_checkpoint(FULL)");
    const contents=source.serialize();
    await mkdir(path.dirname(outputPath),{recursive:true});
    await writeFile(temporary,contents,{flag:"wx"});
    const validation=validateDatabaseFile(temporary);
    if(!validation.ok)throw new Error(`Backup validation failed: ${validation.issues.map((issue)=>issue.message).join("; ")}`);
    await rename(temporary,outputPath);
    return {path:outputPath,bytes:contents.byteLength,sha256:createHash("sha256").update(contents).digest("hex"),validation};
  }finally{
    source.close();
    await unlink(temporary).catch(()=>undefined);
  }
}

export function verifyBackup(filename:string):BackupReport{
  const buffer=readFileSync(filename);
  if(!buffer.byteLength)throw new Error(`Backup is empty: ${filename}`);
  const validation=validateDatabaseFile(filename);
  return {path:filename,bytes:buffer.byteLength,sha256:createHash("sha256").update(buffer).digest("hex"),validation};
}
function validateDatabaseFile(filename:string):ValidationReport{
  const database=openDatabase(filename,{create:false});
  try{return validateDatabase(database);}finally{database.close();}
}

const backupPattern=/^job-search-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sqlite$/;
const isoFilename=(date:Date)=>date.toISOString().replaceAll(":","-").replace(".","-");
const manifestPath=(filename:string)=>`${filename}.json`;

export async function createManagedBackup(
  databasePath:string,
  backupRoot:string,
  now=new Date(),
):Promise<BackupReport>{
  await mkdir(backupRoot,{recursive:true});
  const outputPath=path.join(backupRoot,`job-search-${isoFilename(now)}.sqlite`);
  const backup=await createVerifiedBackup(databasePath,outputPath);
  const manifest:BackupManifest={
    version:1,
    createdAt:now.toISOString(),
    databasePath:path.resolve(databasePath),
    backup,
  };
  await writeFile(manifestPath(outputPath),`${JSON.stringify(manifest,null,2)}\n`,{flag:"wx"});
  return backup;
}

export async function listManagedBackups(backupRoot:string){
  const entries=await readdir(backupRoot,{withFileTypes:true}).catch(error=>{
    if(error instanceof Error&&"code"in error&&error.code==="ENOENT")return[];
    throw error;
  });
  return entries
    .filter(entry=>entry.isFile()&&backupPattern.test(entry.name))
    .map(entry=>path.join(backupRoot,entry.name))
    .sort()
    .reverse();
}

export async function pruneManagedBackups(backupRoot:string,retain=30){
  const backups=await listManagedBackups(backupRoot);
  const valid:string[]=[];
  for(const filename of backups){
    try{
      const report=verifyBackup(filename);
      const manifest=JSON.parse(await readFile(manifestPath(filename),"utf8")) as BackupManifest;
      if(manifest.version===1&&manifest.backup.sha256===report.sha256&&manifest.backup.validation.ok){
        valid.push(filename);
      }
    }catch{
      // Invalid, unrecognized, and incomplete backup pairs are retained for review.
    }
  }
  const pruned:string[]=[];
  for(const filename of valid.slice(retain)){
    await unlink(filename);
    await unlink(manifestPath(filename));
    pruned.push(filename);
  }
  return pruned;
}

export async function ensureDailyBackup(
  databasePath:string,
  backupRoot:string,
  options:{now?:Date;maxAgeMs?:number;retain?:number}={},
):Promise<DailyBackupResult>{
  const now=options.now??new Date();
  const maxAgeMs=options.maxAgeMs??24*60*60*1000;
  for(const filename of await listManagedBackups(backupRoot)){
    try{
      const info=await stat(filename);
      const backup=verifyBackup(filename);
      if(backup.validation.ok&&now.getTime()-info.mtimeMs<maxAgeMs){
        return{created:false,backup,pruned:[]};
      }
    }catch{
      // A broken recent backup must not suppress creation of a valid snapshot.
    }
  }
  const backup=await createManagedBackup(databasePath,backupRoot,now);
  const pruned=await pruneManagedBackups(backupRoot,options.retain??30);
  return{created:true,backup,pruned};
}

export async function restoreVerifiedBackup(
  databasePath:string,
  backupPath:string,
  backupRoot:string,
  now=new Date(),
){
  const selected=verifyBackup(backupPath);
  if(!selected.validation.ok)throw new Error(`Backup is not valid: ${backupPath}`);

  const preRestore=await createManagedBackup(databasePath,backupRoot,now);
  const temporary=`${databasePath}.restore-${process.pid}-${Date.now()}`;
  const displaced=`${databasePath}.pre-restore-${process.pid}-${Date.now()}`;
  try{
    await writeFile(temporary,await readFile(backupPath),{flag:"wx"});
    const staged=verifyBackup(temporary);
    if(!staged.validation.ok)throw new Error(`Staged restore is not valid: ${temporary}`);
    await rename(databasePath,displaced);
    try{
      await rename(temporary,databasePath);
      const restored=verifyBackup(databasePath);
      if(!restored.validation.ok)throw new Error(`Restored database is not valid: ${databasePath}`);
      await unlink(displaced);
      return{restored,preRestore};
    }catch(error){
      await unlink(databasePath).catch(()=>undefined);
      await rename(displaced,databasePath);
      throw error;
    }
  }finally{
    await unlink(temporary).catch(()=>undefined);
  }
}
