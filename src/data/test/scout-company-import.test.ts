import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrateDatabase } from "../database";
import { SqliteScoutCompanyImportStore } from "../scout-company-import-store";
import { importScoutCompanies } from "../../core/scout-company-import";

const roots: string[] = []; afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const fixture = (titlePath="title") => ({ version: 1 as const, companies: [{ id:"company-1", name:"Example Company", active:true, sources:[{ key:"official", type:"json" as const, url:"https://careers.example.test/jobs", active:true, maxPages:2, method:"GET" as const, recordsPath:"jobs", fields:{title:titlePath,url:"url"} }] }] });
describe("private Scout company import",()=>{
  test("is transactional, idempotent, and creates immutable versions",()=>{
    const root=mkdtempSync(path.join("tmp/","scout-import-"));roots.push(root);const database=openDatabase(path.join(root,"test.sqlite"));migrateDatabase(database);const store=new SqliteScoutCompanyImportStore(database);
    expect(importScoutCompanies(fixture(),store)).toEqual({created:1,unchanged:0,versioned:0,rejected:0});
    expect(importScoutCompanies(fixture(),store)).toEqual({created:0,unchanged:1,versioned:0,rejected:0});
    expect(importScoutCompanies(fixture("role.title"),store)).toEqual({created:0,unchanged:0,versioned:1,rejected:0});
    expect((database.query("SELECT count(*) count FROM scout_company_configurations").get() as {count:number}).count).toBe(2);database.close();
  });
  test("rejects the whole file before writing",()=>{
    const root=mkdtempSync(path.join("tmp/","scout-import-"));roots.push(root);const database=openDatabase(path.join(root,"test.sqlite"));migrateDatabase(database);const report=importScoutCompanies({version:1,companies:[fixture().companies[0],fixture().companies[0]]},new SqliteScoutCompanyImportStore(database));expect(report.rejected).toBeGreaterThan(0);expect((database.query("SELECT count(*) count FROM scout_companies").get() as {count:number}).count).toBe(0);database.close();
  });
});
