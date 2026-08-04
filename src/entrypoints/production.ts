import path from "node:path";
import { resolveGigFinderRuntime } from "./runtime";

const applicationRoot = path.resolve(import.meta.dir, "../..");
resolveGigFinderRuntime(applicationRoot);
await import("./web");
