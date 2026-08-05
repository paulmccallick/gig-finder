import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GigData } from "../../core/models";
import { ManagedDocumentService } from "../../core/documents";
import { DataStore, migrateDatabase, migrateLegacyGigArtifacts, openDatabase } from "..";

let database:Database;
let directory:string;
const baseGig: GigData={id:"gig-legacy",company:"Example",title:"Director",externalJobId:null,stage:"identified",outcome:"pending",statusSummary:"Found",lastActivity:"2026-08-05",nextActionDescription:null,nextActionDue:null,fitRating:"good",fitSummary:null,payCurrency:null,payMinimum:null,payMaximum:null,payPeriod:null,payNotes:null,sourceUrl:null,location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null,tagsJson:"[]",hasJobDescription:true,hasInterviewPrep:true};

beforeEach(async()=>{await mkdir(path.resolve("tmp"),{recursive:true});directory=await mkdtemp(path.resolve("tmp","legacy-artifacts-"));database=openDatabase(":memory:");migrateDatabase(database);});
afterEach(async()=>{database.close();await rm(directory,{recursive:true,force:true});});

describe("legacy artifact migration",()=>{
  test("imports registered files atomically as managed version-one documents and is idempotent",async()=>{
    const store=new DataStore(database);store.change({actor:"test",source:"test",summary:"seed"},tx=>tx.gigs.create(baseGig));
    await mkdir(path.join(directory,"gigs",baseGig.id,"interview-prep"),{recursive:true});
    await writeFile(path.join(directory,"gigs",baseGig.id,"job-description.md"),"# Role\n");
    await writeFile(path.join(directory,"gigs",baseGig.id,"interview-prep","general.md"),"# Prepare\n");
    expect(await migrateLegacyGigArtifacts(database,directory)).toEqual({imported:2,existing:0});
    const documents=store.documents.list("gig",baseGig.id);
    expect(documents.map(item=>({type:item.documentType,title:item.title,version:item.currentVersion,provenance:item.uploadProvenance,filePath:item.filePath}))).toEqual([
      {type:"interview_prep",title:"general.md",version:1,provenance:null,filePath:null},
      {type:"job_description",title:"Gig Description",version:1,provenance:null,filePath:null},
    ]);
    expect(documents.every(item=>item.sourceDescription==="Imported from a registered legacy Gig artifact.")).toBe(true);
    expect(await migrateLegacyGigArtifacts(database,directory)).toEqual({imported:0,existing:0});
    expect(store.documents.list("gig",baseGig.id)).toHaveLength(2);
  });

  test("fails before writing when a registered file is missing",async()=>{
    const store=new DataStore(database);store.change({actor:"test",source:"test",summary:"seed"},tx=>tx.gigs.create({...baseGig,hasInterviewPrep:false}));
    await expect(migrateLegacyGigArtifacts(database,directory)).rejects.toThrow("Registered job-description artifact is missing or unreadable");
    expect(store.documents.list("gig",baseGig.id)).toHaveLength(0);
    expect(store.hasChange("migration:legacy-gig-artifacts:v1")).toBe(false);
  });

  test("retains an equivalent managed document without creating a duplicate",async()=>{
    const store=new DataStore(database);store.change({actor:"test",source:"test",summary:"seed"},tx=>tx.gigs.create({...baseGig,hasInterviewPrep:false}));
    await mkdir(path.join(directory,"gigs",baseGig.id),{recursive:true});
    await writeFile(path.join(directory,"gigs",baseGig.id,"job-description.md"),"# Role\n");
    new ManagedDocumentService(store).create({actor:"test",source:"test",summary:"existing"},{links:[{entityType:"gig",entityId:baseGig.id}],documentType:"job_description",title:"Gig Description",description:null,mediaType:"text/markdown",sourceDescription:"Existing import",content:"# Role\n",uploadProvenance:null});
    expect(await migrateLegacyGigArtifacts(database,directory)).toEqual({imported:0,existing:1});
    expect(store.documents.list("gig",baseGig.id)).toHaveLength(1);
  });

  test("imports registered artifacts for a soft-deleted Gig",async()=>{
    const store=new DataStore(database);store.change({actor:"test",source:"test",summary:"seed"},tx=>tx.gigs.create({...baseGig,hasInterviewPrep:false}));
    const raw=store.gigs.get(baseGig.id)!;store.change({actor:"test",source:"test",summary:"delete"},tx=>tx.gigs.delete(baseGig.id,raw.revision));
    await mkdir(path.join(directory,"gigs",baseGig.id),{recursive:true});
    await writeFile(path.join(directory,"gigs",baseGig.id,"job-description.md"),"# Archived role\n");
    expect(await migrateLegacyGigArtifacts(database,directory)).toEqual({imported:1,existing:0});
    expect(store.documents.list("gig",baseGig.id)).toHaveLength(1);
  });
});
