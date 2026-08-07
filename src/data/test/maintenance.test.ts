import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createVerifiedBackup, migrateDatabase, openDatabase, restoreVerifiedBackup } from "..";

const root=path.resolve(import.meta.dir,"../../..");
let directory="";

afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true});directory=""});

async function createPre0021Database(databasePath:string){
  const database=openDatabase(databasePath);
  let latest="";
  for(let index=0;index<=20;index++){
    const prefix=`${String(index).padStart(4,"0")}_`;
    const migration=[...new Bun.Glob(`${prefix}*.sql`).scanSync(path.join(root,"src/data/migrations"))][0];
    if(!migration)throw new Error(`Missing migration ${prefix}`);
    latest=await Bun.file(path.join(root,"src/data/migrations",migration)).text();
    database.exec(latest);
  }
  database.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  database.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)").run(new Bun.CryptoHasher("sha256").update(latest).digest("hex"),1786000000000);
  return database;
}

async function createTestDirectory(){
  await mkdir(path.join(root,"tmp"),{recursive:true});
  directory=await mkdtemp(path.join(root,"tmp","pre-0021-backup-test-"));
  return directory;
}

test("backs up a valid pre-0021 database without current-schema validation blocking it",async()=>{
  await createTestDirectory();
  const databasePath=path.join(directory,"source.sqlite");
  const database=await createPre0021Database(databasePath);
  expect(database.query("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});
  database.close();

  const backupPath=path.join(directory,"backup.sqlite");
  const report=await createVerifiedBackup(databasePath,backupPath);

  expect(await Bun.file(backupPath).exists()).toBe(true);
  expect(report.path).toBe(backupPath);
  expect(report.validation.ok).toBe(false);
  expect(report.validation.issues).toContainEqual({check:"missing_table",message:"Missing required table: interactions"});
});

test("restores a readable pre-0021 backup without current-schema validation blocking it",async()=>{
  await createTestDirectory();
  const databasePath=path.join(directory,"source.sqlite");
  let database=await createPre0021Database(databasePath);
  database.close();
  const backupPath=path.join(directory,"backup.sqlite");
  await createVerifiedBackup(databasePath,backupPath);
  database=openDatabase(databasePath,{create:false});
  migrateDatabase(database);
  database.close();

  const result=await restoreVerifiedBackup(databasePath,backupPath,path.join(directory,"managed-backups"));

  expect(result.restored.validation.ok).toBe(false);
  database=openDatabase(databasePath,{create:false});
  expect(database.query("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});
  expect(database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'").get()).toEqual({name:"meetings"});
  expect(database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='interactions'").get()).toBeNull();
  database.close();
});
