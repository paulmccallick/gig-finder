import { z } from "zod";

export const jobSearchProfileSchema = z.object({
  version: z.string().min(1),
  candidate: z.object({
    displayName: z.string().min(1),
    profession: z.string().min(1),
    functionalFocus: z.array(z.string().min(1)),
    experienceLevel: z.string().min(1),
    yearsOfExperience: z.string().min(1),
    industryExperience: z.array(z.string().min(1)),
    currentSituation: z.string().min(1),
    careerHorizon: z.string().min(1),
  }),
  targets: z.object({
    primaryRoles: z.array(z.string().min(1)),
    conditionalRoles: z.array(z.string().min(1)),
    companyPreferences: z.array(z.string().min(1)),
    locationPreferences: z.array(z.string().min(1)),
  }),
  strengths: z.array(z.string().min(1)),
  bestFitDomains: z.array(z.string().min(1)),
  poorFit: z.array(z.string().min(1)),
  decisionRules: z.array(z.string().min(1)),
});

export type JobSearchProfile = z.infer<typeof jobSearchProfileSchema>;

export interface JobSearchAgentOptions {
  profile: JobSearchProfile;
  model: import("ai").LanguageModel;
  logger?: import("pino").Logger;
  tools?: import("./job-search-tools").JobSearchTools;
}
