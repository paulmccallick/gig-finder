import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactPort, ArtifactVerification } from "../../core/src/ports";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safe = (value: string) => {
  if (!idPattern.test(value)) throw new Error(`Invalid artifact id: ${value}`);
  return value;
};

export class LocalArtifactStore implements ArtifactPort {
  constructor(private readonly root: string) {}

  async jobDescription(gigId: string) {
    return readMarkdown(await this.resolveFile(gigId, "job-description.md"));
  }

  async interviewPrep(gigId: string) {
    const directory = await this.resolveDirectory(gigId, "interview-prep");
    const names = (await markdownNames(directory)).sort();
    return Promise.all(
      names.map(async (name) => ({ name, content: await readMarkdown(path.join(directory, name)) })),
    );
  }

  async jobDescriptionExists(gigId: string) {
    return exists(await this.resolveFile(gigId, "job-description.md"));
  }

  async interviewPrepExists(gigId: string) {
    const directory = await this.resolveDirectory(gigId, "interview-prep");
    return (await markdownNames(directory)).length > 0;
  }

  async verify(expectations: {
    gigs: { id: string; hasJobDescription: boolean; hasInterviewPrep: boolean }[];
  }): Promise<ArtifactVerification> {
    const errors: string[] = [];
    const expected = new Set<string>();

    for (const gig of expectations.gigs) {
      const description = await this.resolveFile(gig.id, "job-description.md");
      const descriptionRelative = path.relative(this.root, description);
      if (gig.hasJobDescription) expected.add(descriptionRelative);
      if (gig.hasJobDescription !== await exists(description)) {
        errors.push(`${gig.id}: has_job_description does not match ${descriptionRelative}`);
      }

      const prepRoot = await this.resolveDirectory(gig.id, "interview-prep");
      const prep = await markdownNames(prepRoot);
      for (const name of prep) expected.add(path.relative(this.root, path.join(prepRoot, name)));
      if (gig.hasInterviewPrep !== (prep.length > 0)) {
        errors.push(`${gig.id}: has_interview_prep does not match its prep directory`);
      }
    }

    const actual = await markdownFiles(this.root);
    return {
      ok: errors.length === 0 && actual.every((file) => expected.has(file)),
      errors,
      unregistered: actual.filter((file) => !expected.has(file)),
    };
  }

  private async resolveFile(gigId: string, filename: string) {
    const id = safe(gigId);
    const canonical = path.join(this.root, "gigs", id, filename);
    const legacy = path.join(this.root, "jobs", id, filename);
    return await exists(canonical) || !await exists(legacy) ? canonical : legacy;
  }

  private async resolveDirectory(gigId: string, directory: string) {
    const id = safe(gigId);
    const canonical = path.join(this.root, "gigs", id, directory);
    const legacy = path.join(this.root, "jobs", id, directory);
    return await isDirectory(canonical) || !await isDirectory(legacy) ? canonical : legacy;
  }
}

async function readMarkdown(file: string) {
  const stats = await lstat(file);
  if (!stats.isFile()) throw new Error(`Artifact is not a regular file: ${file}`);
  return readFile(file, "utf8");
}

async function exists(file: string) {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory: string) {
  try {
    return (await lstat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function markdownNames(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
}

async function markdownFiles(root: string, prefix = ""): Promise<string[]> {
  const directory = path.join(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) =>
    entry.isDirectory()
      ? markdownFiles(root, path.join(prefix, entry.name))
      : entry.isFile() && entry.name.endsWith(".md")
        ? [path.join(prefix, entry.name)]
        : [],
  ));
  return nested.flat().sort();
}
