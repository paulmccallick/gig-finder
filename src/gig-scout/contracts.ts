import { z } from "zod";

export const platformAdapters=["greenhouse","lever","smartrecruiters","ashby","workday","oracle-hcm","adp","eightfold","jibe","successfactors-rmk","gem"] as const;
export const sourceTypes = ["json", "html", "platform"] as const;
export const sourceOutcomeStatuses = [
  "succeeded_with_results", "succeeded_empty_verified", "suspicious_empty", "partial", "failed",
] as const;

const commonSource = z.object({
  key: z.string().trim().min(1).max(100),
  url: z.string().url().refine(value => value.startsWith("https://"), "Official source URLs must use HTTPS."),
  active: z.boolean().default(true),
  maxPages: z.number().int().min(1).max(100).default(10),
}).strict();

export const jsonSourceSchema = commonSource.extend({
  type: z.literal("json"),
  method: z.enum(["GET", "POST"]).default("GET"),
  body: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  recordsPath: z.string().trim().min(1).max(200),
  nextPagePath: z.string().trim().min(1).max(200).optional(),
  fields: z.object({
    id: z.string().trim().min(1).optional(), title: z.string().trim().min(1), url: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(), location: z.string().trim().min(1).optional(),
  }).strict(),
}).strict();

export const htmlSourceSchema = commonSource.extend({
  type: z.literal("html"),
  listingPattern: z.string().trim().min(1).max(500),
  titlePattern: z.string().trim().min(1).max(500),
  urlPattern: z.string().trim().min(1).max(500),
  idPattern: z.string().trim().min(1).max(500).optional(),
  descriptionPattern: z.string().trim().min(1).max(500).optional(),
  locationPattern: z.string().trim().min(1).max(500).optional(),
  expectedSurfacePattern: z.string().trim().min(1).max(500),
}).strict();

export const platformSourceSchema=commonSource.extend({
  type:z.literal("platform"),adapter:z.enum(platformAdapters),searchTerms:z.array(z.string().trim().min(1).max(100)).max(25).default([]),
}).strict();

export const sourceConfigurationSchema = z.discriminatedUnion("type", [jsonSourceSchema, htmlSourceSchema,platformSourceSchema]);
export const companyScanRequestSchema = z.object({
  companyId: z.string().trim().min(1).max(100),
  configurationVersionId: z.string().trim().min(1).max(100),
  sources: z.array(sourceConfigurationSchema).min(1).max(50),
}).strict();

export type SourceConfiguration = z.infer<typeof sourceConfigurationSchema>;
export type CompanyScanRequest = z.infer<typeof companyScanRequestSchema>;
export type SourceOutcomeStatus = typeof sourceOutcomeStatuses[number];

export interface SourceDiagnostic { code: string; category: "validation" | "extraction" | "network"; count: number; message: string; }
export interface SourceAttempt { adapter: SourceConfiguration["type"]; stage: string; requestCount: number; responseCount: number; candidateCount: number; acceptedCount: number; rejectedCount: number; validationStatus: "verified" | "suspicious" | "failed"; startedAt: string; completedAt: string; failure?: { code: string; message: string }; diagnostics: SourceDiagnostic[]; }
export interface PositionProvenance { sourceKey: string; sourceUrl: string; description: "listing" | "detail" | "none"; }
export interface NormalizedPosition { sourceKey: string; externalId: string | null; canonicalUrl: string; title: string; location: string | null; description: string | null; provenance: PositionProvenance; }
export interface SourceOutcome { sourceKey: string; status: SourceOutcomeStatus; positions: NormalizedPosition[]; attempts: SourceAttempt[]; }
export interface CompanyScanResult { companyId: string; configurationVersionId: string; positions: NormalizedPosition[]; sources: SourceOutcome[]; }
