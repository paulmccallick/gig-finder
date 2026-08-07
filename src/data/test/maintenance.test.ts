import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createVerifiedBackup, openDatabase } from "..";

const root=path.resolve(import.meta.dir,"../../..");
let directory="";

afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true});directory=""});

test("backs up a valid pre-0021 database without current-schema validation blocking it",async()=>{
  await mkdir(path.join(root,"tmp"),{recursive:true});
  directory=await mkdtemp(path.join(root,"tmp","pre-0021-backup-test-"));
  const databasePath=path.join(directory,"source.sqlite");
  const database=openDatabase(databasePath);
  for(let index=0;index<=20;index++){
    const prefix=`${String(index).padStart(4,"0")}_`;
    const migration=[...new Bun.Glob(`${prefix}*.sql`).scanSync(path.join(root,"src/data/migrations"))][0];
    if(!migration)throw new Error(`Missing migration ${prefix}`);
    database.exec(await Bun.file(path.join(root,"src/data/migrations",migration)).text());
  }
  expect(database.query("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});
  database.close();

  const backupPath=path.join(directory,"backup.sqlite");
  const report=await createVerifiedBackup(databasePath,backupPath);

  expect(await Bun.file(backupPath).exists()).toBe(true);
  expect(report.path).toBe(backupPath);
  expect(report.validation.ok).toBe(false);
  expect(report.validation.issues).toContainEqual({check:"missing_table",message:"Missing required table: interactions"});
});
