import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const fixtureRoot=path.resolve(process.cwd(),"tmp","architecture-boundary");

afterEach(()=>rmSync(fixtureRoot,{recursive:true,force:true}));

test("dependency cruiser rejects type-only data imports of core service implementations",()=>{
  const dataDirectory=path.join(fixtureRoot,"src","data");
  mkdirSync(dataDirectory,{recursive:true});
  writeFileSync(path.join(dataDirectory,"invalid-adapter.ts"),`import type { ManagedDocumentService } from "../../../../src/core/managed-document-service";\nexport type InvalidDependency = ManagedDocumentService;\n`);
  writeFileSync(path.join(fixtureRoot,"dependency-cruiser.cjs"),`const base=require("../../.dependency-cruiser.cjs");\nmodule.exports={forbidden:base.forbidden.filter(rule=>rule.name==="data-does-not-orchestrate-core-services").map(rule=>({...rule,from:{path:"^tmp/architecture-boundary/src/data/"}})),options:base.options};\n`);
  const result=spawnSync("bunx",["depcruise","tmp/architecture-boundary/src","--config","tmp/architecture-boundary/dependency-cruiser.cjs"],{cwd:process.cwd(),encoding:"utf8"});
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain("data-does-not-orchestrate-core-services");
});
