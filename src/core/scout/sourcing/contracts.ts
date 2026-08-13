import { z } from "zod";

export const sourceTypes = ["json", "html"] as const;
export const sourceOutcomeStatuses = [
  "succeeded_with_results",
  "succeeded_empty_verified",
  "suspicious_empty",
  "partial",
  "failed",
] as const;

const commonSource = z
  .object({
    key: z.string().trim().min(1).max(100),
    url: z
      .string()
      .url()
      .refine(
        (value) => value.startsWith("https://"),
        "Official source URLs must use HTTPS.",
      ),
    active: z.boolean().default(true),
  })
  .strict();

export const customJsonSourceSchema = commonSource
  .extend({
    type: z.literal("json"),
    method: z.enum(["GET", "POST"]).default("GET"),
    body: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .optional(),
    recordsPath: z.string().trim().min(1).max(200),
    nextPagePath: z.string().trim().min(1).max(200).optional(),
    scriptEnvelope: z
      .object({
        selector: z.string().trim().min(1).max(300),
        valuePath: z.string().trim().min(1).max(200).optional(),
        assignment: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    fields: z
      .object({
        id: z.string().trim().min(1).optional(),
        title: z.string().trim().min(1),
        url: z.string().trim().min(1),
        urlPrefix: z.string().max(300).optional(),
        description: z.string().trim().min(1).optional(),
        location: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const reusableJsonSourceSchema = commonSource
  .extend({
    type: z.literal("json"),
    template: z
      .object({
        id: z.string().trim().min(1).max(100),
        version: z.number().int().positive(),
      })
      .strict(),
    variables: z.record(z.string(), z.string().trim().min(1).max(300)).default({}),
    overrides: z.record(z.string(), z.string().trim().max(300)).default({}),
  })
  .strict();

export const jsonSourceSchema = z.union([
  reusableJsonSourceSchema,
  customJsonSourceSchema,
]);

export const htmlSourceSchema = commonSource
  .extend({
    type: z.literal("html"),
    listingSelector: z.string().trim().min(1).max(300).optional(),
    titleField: z
      .object({
        selector: z.string().trim().min(1).max(300).optional(),
        attribute: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    urlField: z
      .object({
        selector: z.string().trim().min(1).max(300).optional(),
        attribute: z.string().trim().min(1).max(100).default("href"),
      })
      .strict()
      .optional(),
    locationField: z
      .object({
        selector: z.string().trim().min(1).max(300),
        attribute: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    idField: z
      .object({
        selector: z.string().trim().min(1).max(300).optional(),
        attribute: z.string().trim().min(1).max(100),
      })
      .strict()
      .optional(),
    descriptionField: z
      .object({
        selector: z.string().trim().min(1).max(300),
        attribute: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    listingSurfaceSelector: z.string().trim().min(1).max(300).optional(),
    emptyStateSelector: z.string().trim().min(1).max(300).optional(),
    nextPage: z
      .object({
        selector: z.string().trim().min(1).max(300),
        attribute: z.string().trim().min(1).max(100).default("href"),
        urlTemplate: z
          .string()
          .url()
          .refine(
            (value) => value.includes("{page}"),
            "HTML pagination URL templates must include {page}.",
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((source, context) => {
    const complete = Boolean(
      source.listingSelector &&
        source.titleField &&
        source.urlField &&
        source.listingSurfaceSelector,
    );
    if (!complete)
      context.addIssue({
        code: "custom",
        message: "HTML sources require complete DOM selector configuration.",
      });
  });

export const sourceConfigurationSchema = z.union([
  jsonSourceSchema,
  htmlSourceSchema,
]);
export const scoutSearchProfileSchema = z
  .object({
    terms: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
    locations: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  })
  .strict()
  .default({ terms: [], locations: [] });

export const defaultScoutSearchProfile = Object.freeze({
  terms: Object.freeze([
    "Director",
    "Senior Director",
    "Sr. Director",
    "Senior Vice President",
    "SVP",
    "Vice President",
    "VP Engineering",
    "Head of Engineering",
    "Head of Technology",
  ]),
  locations: Object.freeze([
    "Seattle",
    "Bellevue",
    "Redmond",
    "Remote",
    "Washington",
  ]),
});

export function resolveScoutSearchProfile(
  profile?: Partial<ScoutSearchProfile>,
): ScoutSearchProfile {
  const parsed = scoutSearchProfileSchema.parse(profile ?? {});
  return {
    terms: parsed.terms.length
      ? [...parsed.terms]
      : [...defaultScoutSearchProfile.terms],
    locations: parsed.locations.length
      ? [...parsed.locations]
      : [...defaultScoutSearchProfile.locations],
  };
}

export const companyScanRequestSchema = z
  .object({
    companyId: z.string().trim().min(1).max(100),
    configurationVersionId: z.string().trim().min(1).max(100),
    sources: z.array(sourceConfigurationSchema).min(1).max(50),
    searchProfile: scoutSearchProfileSchema,
  })
  .strict();

export type SourceConfiguration = z.infer<typeof sourceConfigurationSchema>;
export const scoutRuntimePolicySchema = z
  .object({
    maxPages: z.number().int().min(1).max(5000).default(2000),
    maxRecords: z.number().int().min(1).max(100_000).default(10_000),
    maxRequests: z.number().int().min(1).max(10_000).default(2500),
    maxListingBytes: z.number().int().min(1).default(6_000_000),
    maxDetailBytes: z.number().int().min(1).default(1_000_000),
    retries: z.number().int().min(0).max(10).default(2),
    sourceDurationMs: z.number().int().min(1).default(1_800_000),
  })
  .strict();
export type ScoutRuntimePolicy = z.infer<typeof scoutRuntimePolicySchema>;
export type ScoutSearchProfile = z.infer<
  typeof scoutSearchProfileSchema
>;
export type CompanyScanRequest = z.input<typeof companyScanRequestSchema>;
export type SourceOutcomeStatus = (typeof sourceOutcomeStatuses)[number];

export interface SourceDiagnostic {
  code: string;
  category: "validation" | "extraction" | "network";
  count: number;
  message: string;
}
export interface SourceAttempt {
  sourceMethod: SourceConfiguration["type"];
  stage: string;
  requestCount: number;
  responseCount: number;
  sourceReportedTotal?: number | null;
  recordsReceived?: number;
  recordsParsed?: number;
  recordsEvaluable?: number;
  recordsEvaluated?: number;
  pagesRequested?: number;
  pagesValidated?: number;
  uniqueIdentities?: number;
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  validationStatus: "verified" | "suspicious" | "failed";
  startedAt: string;
  completedAt: string;
  failure?: { code: string; message: string };
  diagnostics: SourceDiagnostic[];
}
export interface PositionProvenance {
  sourceKey: string;
  sourceUrl: string;
  description: "listing" | "detail" | "none";
  descriptionUrl: string | null;
}
export interface NormalizedPosition {
  sourceKey: string;
  externalId: string | null;
  canonicalUrl: string;
  title: string;
  location: string | null;
  description: string | null;
  provenance: PositionProvenance;
}
export interface SourceOutcome {
  sourceKey: string;
  status: SourceOutcomeStatus;
  positions: NormalizedPosition[];
  attempts: SourceAttempt[];
}
export interface CompanyScanResult {
  companyId: string;
  configurationVersionId: string;
  positions: NormalizedPosition[];
  sources: SourceOutcome[];
}
