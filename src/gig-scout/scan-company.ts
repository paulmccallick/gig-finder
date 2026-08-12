import {
  companyScanRequestSchema,
  type CompanyScanRequest,
  type CompanyScanResult,
} from "./contracts";
import type { GigScoutClock, GigScoutHttpPort } from "./ports";
import { scanSource } from "./adapters";
export async function scanCompany(
  request: CompanyScanRequest,
  dependencies: {
    http: GigScoutHttpPort;
    clock?: GigScoutClock;
    signal?: AbortSignal;
  },
): Promise<CompanyScanResult> {
  const input = companyScanRequestSchema.parse(request);
  const clock = dependencies.clock ?? { now: () => new Date() };
  const sources = [];
  for (const source of input.sources.filter((item) => item.active))
    sources.push(
      await scanSource(source, dependencies.http, clock, dependencies.signal),
    );
  return {
    companyId: input.companyId,
    configurationVersionId: input.configurationVersionId,
    sources,
    positions: sources.flatMap((source) => source.positions),
  };
}
