import { createHash } from "node:crypto";
import { z } from "zod";
import {
  sourceConfigurationSchema,
  type SourceConfiguration,
} from "../sourcing/contracts";
import {
  validateTemplateSourceInputs,
  type TemplateResolver,
} from "../sourcing/adapters/templates/definitions";

export const scoutCompanyImportSchema = z
  .object({
    version: z.literal(1),
    companies: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(100),
            name: z.string().trim().min(1).max(200),
            active: z.boolean().default(true),
            sources: z.array(sourceConfigurationSchema).min(1).max(50),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = new Set<string>();
    for (const [index, company] of input.companies.entries()) {
      if (ids.has(company.id))
        context.addIssue({
          code: "custom",
          path: ["companies", index, "id"],
          message: "Company IDs must be unique.",
        });
      ids.add(company.id);
      const activeSources = company.sources.filter((source) => source.active);
      if (activeSources.length !== 1)
        context.addIssue({
          code: "custom",
          path: ["companies", index, "sources"],
          message: "Each company must configure exactly one active official source.",
        });
    }
  });
export type ScoutCompanyImport = z.infer<typeof scoutCompanyImportSchema>;
export interface ScoutCompanyImportReport {
  created: number;
  unchanged: number;
  versioned: number;
  rejected: number;
}

export interface ScoutCompanyImportStore {
  transaction<T>(operation: () => T): T;
  current(companyId: string): { fingerprint: string; version: number } | null;
  createCompany(input: {
    id: string;
    name: string;
    active: boolean;
    configurationId: string;
    fingerprint: string;
    sources: SourceConfiguration[];
    at: string;
  }): void;
  versionCompany(input: {
    id: string;
    name: string;
    active: boolean;
    configurationId: string;
    version: number;
    fingerprint: string;
    sources: SourceConfiguration[];
    at: string;
  }): void;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const fingerprint = (company: ScoutCompanyImport["companies"][number]) =>
  createHash("sha256")
    .update(canonical({ active: company.active, sources: company.sources }))
    .digest("hex");
const identifier = (kind: string, companyId: string, value: string | number) =>
  `${kind}_${createHash("sha256").update(`${companyId}\0${value}`).digest("hex").slice(0, 32)}`;

export function importScoutCompanies(
  raw: unknown,
  store: ScoutCompanyImportStore,
  templates?: TemplateResolver,
  now = new Date(),
): ScoutCompanyImportReport {
  const parsed = scoutCompanyImportSchema.safeParse(raw);
  if (!parsed.success)
    return {
      created: 0,
      unchanged: 0,
      versioned: 0,
      rejected: parsed.error.issues.length,
    };
  try {
    for (const company of parsed.data.companies)
      for (const source of company.sources)
        if (source.type === "json" && "template" in source) {
          if (!templates) throw new Error("scout_template_resolver_required");
          validateTemplateSourceInputs(
            source.template,
            source.variables,
            source.overrides,
            templates,
          );
        }
  } catch {
    return { created: 0, unchanged: 0, versioned: 0, rejected: 1 };
  }
  return store.transaction(() => {
    const report = { created: 0, unchanged: 0, versioned: 0, rejected: 0 };
    const at = now.toISOString();
    for (const company of parsed.data.companies) {
      const hash = fingerprint(company);
      const current = store.current(company.id);
      if (!current) {
        store.createCompany({
          ...company,
          configurationId: identifier("scfg", company.id, 1),
          fingerprint: hash,
          at,
        });
        report.created++;
      } else if (current.fingerprint === hash) report.unchanged++;
      else {
        const version = current.version + 1;
        store.versionCompany({
          ...company,
          configurationId: identifier("scfg", company.id, version),
          version,
          fingerprint: hash,
          at,
        });
        report.versioned++;
      }
    }
    return report;
  });
}

export function importScoutCompany(
  raw: unknown,
  store: ScoutCompanyImportStore,
  templates?: TemplateResolver,
  now = new Date(),
): ScoutCompanyImportReport {
  return importScoutCompanies(
    { version: 1, companies: [raw] },
    store,
    templates,
    now,
  );
}
