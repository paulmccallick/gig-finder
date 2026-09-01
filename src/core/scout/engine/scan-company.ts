import {
  companyScanRequestSchema,
  type CompanyScanRequest,
  type CompanyScanResult,
  type SourceOutcome,
  scoutRuntimePolicySchema,
  type ScoutRuntimePolicy,
} from "../sourcing/contracts";
import type { GigScoutClock, GigScoutHttpPort } from "../sourcing/ports";
import { scanSource } from "../sourcing/adapters";
import type { TemplateResolver } from "../sourcing/adapters/templates/definitions";
export async function scanCompany(
  request: CompanyScanRequest,
  dependencies: {
    http: GigScoutHttpPort;
    clock?: GigScoutClock;
    signal?: AbortSignal;
    policy?: Partial<ScoutRuntimePolicy>;
    templates?: TemplateResolver;
  },
): Promise<CompanyScanResult> {
  const input = companyScanRequestSchema.parse(request);
  const clock = dependencies.clock ?? { now: () => new Date() };
  const policy = scoutRuntimePolicySchema.parse(dependencies.policy ?? {});
  const sources: SourceOutcome[] = [];
  for (const source of input.sources.filter((item) => item.active))
    {
      const outcome = await scanSource(
        source,
        input.searchProfile,
        policy,
        dependencies.http,
        clock,
        dependencies.templates ?? {
          resolve() {
            throw new Error("scout_template_resolver_required");
          },
        },
        dependencies.signal,
      );
      sources.push({
        ...outcome,
        positions: outcome.positions.map((position) => ({
          ...position,
          company: input.companyName,
        })),
      });
    }
  return {
    companyId: input.companyId,
    configurationVersionId: input.configurationVersionId,
    sources,
    positions: sources.flatMap((source) => source.positions),
  };
}
