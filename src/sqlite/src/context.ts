import path from "node:path";
import { readFileSync } from "node:fs";

export interface JobSearchContextConfig {
  version: number;
  actor: string;
  profile?: string;
}

export interface JobSearchContextPaths {
  root: string;
  database: string;
  artifacts: string;
  profile: string;
  logs: string;
  backups: string;
  meetingParticipantMigration: string;
  actor: string;
}

type ContextEnvironment = Record<string, string | undefined>;

function optionalAbsolute(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : undefined;
}

function readContextConfig(root: string): JobSearchContextConfig {
  const filename = path.join(root, "config.json");
  try {
    const parsed = JSON.parse(readFileSync(filename, "utf8")) as Partial<JobSearchContextConfig>;
    if (parsed.version !== 1) throw new Error("version must be 1");
    if (typeof parsed.actor !== "string" || !parsed.actor.trim()) {
      throw new Error("actor must be a non-empty string");
    }
    if (parsed.profile !== undefined && (typeof parsed.profile !== "string" || !parsed.profile.trim())) {
      throw new Error("profile must be a non-empty string when provided");
    }
    return {
      version: 1,
      actor: parsed.actor.trim(),
      ...(parsed.profile ? { profile: parsed.profile } : {}),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid job-search context configuration: ${filename}`, { cause: error });
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, actor: "Job Search User" };
    }
    if (error instanceof Error && error.message.startsWith("Invalid job-search")) throw error;
    throw new Error(`Invalid job-search context configuration: ${filename}`, { cause: error });
  }
}

export function resolveJobSearchContext(
  applicationRoot: string,
  environment: ContextEnvironment = process.env,
): JobSearchContextPaths {
  const root = optionalAbsolute(environment.JOB_SEARCH_CONTEXT_ROOT)
    ?? path.join(applicationRoot, "context");
  const config = readContextConfig(root);
  const profile = optionalAbsolute(environment.JOB_SEARCH_PROFILE)
    ?? path.resolve(root, config.profile ?? "profile/job-search-profile.json");

  return {
    root,
    database: optionalAbsolute(environment.JOB_SEARCH_DATABASE)
      ?? path.join(root, "data", "job-search.sqlite"),
    artifacts: optionalAbsolute(environment.JOB_SEARCH_ARTIFACTS)
      ?? path.join(root, "artifacts"),
    profile,
    logs: optionalAbsolute(environment.LOG_DIRECTORY)
      ?? path.join(root, "logs"),
    backups: optionalAbsolute(environment.JOB_SEARCH_BACKUP_ROOT)
      ?? path.join(root, "backups"),
    meetingParticipantMigration: optionalAbsolute(
      environment.JOB_SEARCH_MEETING_PARTICIPANT_MIGRATION,
    ) ?? path.join(root, "data", "migration", "0010-meeting-participants.json"),
    actor: environment.JOB_SEARCH_ACTOR?.trim() || config.actor,
  };
}
