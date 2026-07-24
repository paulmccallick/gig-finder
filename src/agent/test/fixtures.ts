import type { JobSearchProfile } from "../types";

export const testJobSearchProfile: JobSearchProfile = {
  version: "1",
  candidate: {
    displayName: "Jordan",
    profession: "Product and operations leadership",
    functionalFocus: ["Product development", "Cross-functional delivery"],
    experienceLevel: "Experienced people leader",
    yearsOfExperience: "More than ten years",
    industryExperience: ["Consumer services", "Business software"],
    currentSituation: "Conducting an active job search.",
    careerHorizon: "Long term.",
  },
  targets: {
    primaryRoles: ["Director of Product"],
    conditionalRoles: ["Head of Product at a smaller company"],
    companyPreferences: ["Stable product companies"],
    locationPreferences: ["Hybrid", "Remote"],
  },
  strengths: ["Building teams", "Delivering customer outcomes"],
  bestFitDomains: ["Product development"],
  poorFit: ["Individual-contributor roles"],
  decisionRules: ["Prioritize credible scope and company stability."],
};
