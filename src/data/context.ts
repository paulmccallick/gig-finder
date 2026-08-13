import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

export interface GigFinderContextConfig {
  version: number;
  actor: string;
  profile?: string;
  profileDocuments?: string;
}

export interface GigFinderContextPaths {
  root: string;
  database: string;
  artifacts: string;
  profile: string;
  profileDocuments: string;
  logs: string;
  backups: string;
  meetingParticipantMigration: string;
  scoutQueue: string;
  scoutDescriptions: string;
  actor: string;
}

type ContextEnvironment = Record<string, string | undefined>;

function optionalAbsolute(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : undefined;
}

function relativeContextPath(root: string, value: string, property: string) {
  if (path.isAbsolute(value)) {
    throw new Error(`${property} must be relative to the context root`);
  }
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${property} must resolve to a directory within the context root`);
  }
  return resolved;
}

function hasDatabaseContents(filename: string) {
  try {
    return statSync(filename).size > 0;
  } catch {
    return false;
  }
}

function readContextConfig(filename: string): GigFinderContextConfig {
  try {
    const parsed = JSON.parse(readFileSync(filename, "utf8")) as Partial<GigFinderContextConfig>;
    if (parsed.version !== 1) throw new Error("version must be 1");
    if (typeof parsed.actor !== "string" || !parsed.actor.trim()) {
      throw new Error("actor must be a non-empty string");
    }
    if (parsed.profile !== undefined && (typeof parsed.profile !== "string" || !parsed.profile.trim())) {
      throw new Error("profile must be a non-empty string when provided");
    }
    if (parsed.profileDocuments !== undefined && (typeof parsed.profileDocuments !== "string" || !parsed.profileDocuments.trim())) {
      throw new Error("profileDocuments must be a non-empty string when provided");
    }
    return {
      version: 1,
      actor: parsed.actor.trim(),
      ...(parsed.profile ? { profile: parsed.profile } : {}),
      ...(parsed.profileDocuments ? { profileDocuments: parsed.profileDocuments } : {}),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid gig-finder context configuration: ${filename}`, { cause: error });
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, actor: "GigFinder User" };
    }
    if (error instanceof Error && error.message.startsWith("Invalid gig-finder")) throw error;
    throw new Error(`Invalid gig-finder context configuration: ${filename}`, { cause: error });
  }
}

export function resolveGigFinderContext(
  applicationRoot: string,
  environment: ContextEnvironment = process.env,
): GigFinderContextPaths {
  const root = optionalAbsolute(environment.GIG_FINDER_CONTEXT_ROOT)
    ?? optionalAbsolute(environment.JOB_SEARCH_CONTEXT_ROOT)
    ?? path.join(applicationRoot, "context");
  const config = readContextConfig(
    optionalAbsolute(environment.GIG_FINDER_CONFIG) ?? path.join(root, "config.json"),
  );
  const configuredProfile = config.profile ? path.resolve(root, config.profile) : undefined;
  const candidateProfile = path.join(root, "profile", "candidate-profile.json");
  const legacyProfile = path.join(root, "profile", "job-search-profile.json");
  const profile = optionalAbsolute(environment.GIG_FINDER_PROFILE)
    ?? optionalAbsolute(environment.JOB_SEARCH_PROFILE)
    ?? configuredProfile
    ?? (existsSync(candidateProfile) || !existsSync(legacyProfile) ? candidateProfile : legacyProfile);
  const gigFinderDatabase = path.join(root, "data", "gig-finder.sqlite");
  const legacyDatabase = path.join(root, "data", "job-search.sqlite");

  return {
    root,
    database: optionalAbsolute(environment.GIG_FINDER_DATABASE)
      ?? optionalAbsolute(environment.JOB_SEARCH_DATABASE)
      ?? (hasDatabaseContents(gigFinderDatabase) || !existsSync(legacyDatabase)
        ? gigFinderDatabase
        : legacyDatabase),
    artifacts: optionalAbsolute(environment.GIG_FINDER_ARTIFACTS)
      ?? optionalAbsolute(environment.JOB_SEARCH_ARTIFACTS)
      ?? path.join(root, "artifacts"),
    profile,
    profileDocuments: optionalAbsolute(environment.GIG_FINDER_PROFILE_DOCUMENTS)
      ?? (config.profileDocuments
        ? relativeContextPath(root, config.profileDocuments, "profileDocuments")
        : path.join(root, "profile", "documents")),
    logs: optionalAbsolute(environment.LOG_DIRECTORY)
      ?? path.join(root, "logs"),
    backups: optionalAbsolute(environment.GIG_FINDER_BACKUP_ROOT)
      ?? optionalAbsolute(environment.JOB_SEARCH_BACKUP_ROOT)
      ?? path.join(root, "backups"),
    meetingParticipantMigration: optionalAbsolute(
      environment.GIG_FINDER_MEETING_PARTICIPANT_MIGRATION,
    ) ?? optionalAbsolute(
      environment.JOB_SEARCH_MEETING_PARTICIPANT_MIGRATION,
    ) ?? path.join(root, "data", "migration", "0010-meeting-participants.json"),
    scoutQueue: optionalAbsolute(environment.GIG_FINDER_SCOUT_QUEUE)
      ?? path.join(root, "data", "gig-scout-queue.sqlite"),
    scoutDescriptions: optionalAbsolute(environment.GIG_FINDER_SCOUT_DESCRIPTIONS)
      ?? path.join(root, "artifacts", "gig-scout", "descriptions"),
    actor: environment.GIG_FINDER_ACTOR?.trim()
      || environment.JOB_SEARCH_ACTOR?.trim()
      || config.actor,
  };
}
