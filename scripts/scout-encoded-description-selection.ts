import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  readSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import {
  createDirectoryAt,
  hasDescriptorErrorCode,
  openDirectoryAt,
  openFileAt,
  openRootDirectory,
  removeAt,
  replaceAt,
  type DirectoryDescriptor,
} from "./descriptor-path";

export interface EncodedDescriptionSelectionReport {
  generatedAt: string;
  complete: boolean;
  selected: Array<{
    positionId: string;
    state: string;
    origin: string | null;
    linkedGigId: string | null;
    company: string;
  }>;
  excluded: Record<string, number>;
  unresolved: Array<{
    positionId: string;
    code: "missing_artifact" | "unreadable_artifact";
  }>;
}

interface SelectionInput {
  databasePath: string;
  descriptionsPath: string;
  outputPath: string;
  generatedAt?: string;
  pathHooks?: {
    beforeArtifactFinalOpen?(): void | Promise<void>;
    beforeOutputTemporaryOpen?(): void | Promise<void>;
  };
}

interface SelectionRow {
  positionId: string;
  company: string;
  state: string | null;
  origin: string | null;
  linkedGigId: string | null;
  completedPromotionGigId: string | null;
  filePath: string | null;
}

type ArtifactInspection = "encoded" | "clean" | "missing" | "unreadable";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const allowedOutputRoot = path.join(repositoryRoot, "tmp");
const maxArtifactBytes = 1_000_000;
const encodedStructuralTag = /(?:&(?:amp;)?(?:lt|#0*60|#x0*3c);)\s*\/?\s*(?:div|p|ul|ol|li|h[1-6]|a|strong|em)\b[\s\S]{0,256}?(?:&(?:amp;)?(?:gt|#0*62|#x0*3e);)/i;
const symbolicLinkError = "Selection report paths must not contain symbolic links.";

function isWithinOrEqual(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative));
}

function descriptorPath(root: string, candidate: string) {
  if (!isWithinOrEqual(root, candidate) || candidate === root) return null;
  const components = path.relative(root, candidate).split(path.sep);
  const name = components.pop();
  if (!name) return null;
  return { directories: components, name };
}

function openExistingParent(root: string, directories: string[]) {
  let current = openRootDirectory(root);
  try {
    for (const component of directories) {
      const next = openDirectoryAt(current, component);
      current.close();
      current = next;
    }
    return current;
  } catch (error) {
    current.close();
    throw error;
  }
}

async function inspectArtifact(
  descriptionsRoot: string,
  filePath: string | null,
  beforeFinalOpen?: () => void | Promise<void>,
): Promise<ArtifactInspection> {
  if (!filePath) return "missing";

  const root = path.resolve(descriptionsRoot);
  const artifact = path.resolve(root, filePath);
  const relative = descriptorPath(root, artifact);
  if (!relative) return "unreadable";

  let parent: DirectoryDescriptor | undefined;
  let fileDescriptor: number | undefined;
  try {
    parent = openExistingParent(root, relative.directories);
    await beforeFinalOpen?.();
    fileDescriptor = openFileAt(
      parent,
      relative.name,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const metadata = fstatSync(fileDescriptor);
    if (!metadata.isFile() || metadata.size > maxArtifactBytes) {
      return "unreadable";
    }

    const buffer = Buffer.alloc(Number(metadata.size));
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(
        fileDescriptor,
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const markdown = buffer.subarray(0, offset).toString("utf8");
    return encodedStructuralTag.test(markdown) ? "encoded" : "clean";
  } catch (error) {
    return hasDescriptorErrorCode(error, "ENOENT") ? "missing" : "unreadable";
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    parent?.close();
  }
}

function openOutputParent(directories: string[]) {
  try {
    mkdirSync(allowedOutputRoot, { mode: 0o700 });
  } catch (error) {
    if (!hasDescriptorErrorCode(error, "EEXIST")) throw error;
  }

  let current = openRootDirectory(allowedOutputRoot);
  try {
    for (const component of directories) {
      let next: DirectoryDescriptor;
      try {
        next = openDirectoryAt(current, component);
      } catch (error) {
        if (!hasDescriptorErrorCode(error, "ENOENT")) throw error;
        try {
          createDirectoryAt(current, component, 0o700);
        } catch (createError) {
          if (!hasDescriptorErrorCode(createError, "EEXIST")) throw createError;
        }
        next = openDirectoryAt(current, component);
      }
      current.close();
      current = next;
    }
    return current;
  } catch (error) {
    current.close();
    if (hasDescriptorErrorCode(error, "ELOOP", "ENOTDIR")) {
      throw new Error(symbolicLinkError, { cause: error });
    }
    throw error;
  }
}

function assertSafeOutputFinal(parent: DirectoryDescriptor, name: string) {
  let existing: number | undefined;
  try {
    existing = openFileAt(
      parent,
      name,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    if (!fstatSync(existing).isFile()) {
      throw new Error("Selection report output must be a regular file.");
    }
  } catch (error) {
    if (hasDescriptorErrorCode(error, "ENOENT")) return;
    if (hasDescriptorErrorCode(error, "ELOOP")) {
      throw new Error(symbolicLinkError, { cause: error });
    }
    throw error;
  } finally {
    if (existing !== undefined) closeSync(existing);
  }
}

function writeBuffer(fileDescriptor: number, content: Buffer) {
  let offset = 0;
  while (offset < content.length) {
    const bytesWritten = writeSync(
      fileDescriptor,
      content,
      offset,
      content.length - offset,
      null,
    );
    if (bytesWritten === 0) {
      throw new Error("Selection report write made no progress.");
    }
    offset += bytesWritten;
  }
}

async function writeReport(
  output: string,
  report: EncodedDescriptionSelectionReport,
  beforeTemporaryOpen?: () => void | Promise<void>,
) {
  const relative = descriptorPath(allowedOutputRoot, output);
  if (!relative) {
    throw new Error(
      "The encoded-description selection report must be written beneath repository-local tmp/.",
    );
  }

  const parent = openOutputParent(relative.directories);
  const temporaryName = `.encoded-selection-${crypto.randomUUID()}.tmp`;
  let temporaryDescriptor: number | undefined;
  let temporaryExists = false;
  let cleanupError: unknown;
  try {
    assertSafeOutputFinal(parent, relative.name);
    await beforeTemporaryOpen?.();
    temporaryDescriptor = openFileAt(
      parent,
      temporaryName,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | constants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    if (!fstatSync(temporaryDescriptor).isFile()) {
      throw new Error("Selection report temporary output must be a regular file.");
    }
    fchmodSync(temporaryDescriptor, 0o600);
    writeBuffer(
      temporaryDescriptor,
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
    );
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;

    replaceAt(parent, temporaryName, relative.name);
    temporaryExists = false;
    try {
      fsyncSync(parent.fd);
    } catch (error) {
      if (!hasDescriptorErrorCode(error, "EINVAL")) throw error;
    }
  } finally {
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    if (temporaryExists) {
      try {
        removeAt(parent, temporaryName);
      } catch (error) {
        if (!hasDescriptorErrorCode(error, "ENOENT")) cleanupError = error;
      }
    }
    parent.close();
  }
  if (cleanupError instanceof Error) throw cleanupError;
  if (cleanupError) {
    throw new Error("Selection report temporary cleanup failed.", {
      cause: cleanupError,
    });
  }
}

function increment(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function isEligible(row: SelectionRow) {
  if (row.state === "needs_user_review") return true;
  if (row.state === "irrelevant" && row.origin === "agent") return true;
  return row.state === "promoted"
    && row.linkedGigId !== null
    && row.completedPromotionGigId === row.linkedGigId;
}

export async function writeEncodedDescriptionSelectionReport(
  input: SelectionInput,
): Promise<EncodedDescriptionSelectionReport> {
  const output = path.resolve(input.outputPath);
  if (!isWithinOrEqual(allowedOutputRoot, output) || output === allowedOutputRoot) {
    throw new Error(
      "The encoded-description selection report must be written beneath repository-local tmp/.",
    );
  }

  const database = new Database(path.resolve(input.databasePath), {
    readonly: true,
    strict: true,
  });
  try {
    const rows = database.query(`
      SELECT
        p.id positionId,
        c.name company,
        s.state,
        decision.origin,
        s.linked_gig_id linkedGigId,
        promotion.gig_id completedPromotionGigId,
        artifact.file_path filePath
      FROM scout_positions p
      JOIN scout_companies c ON c.id=p.company_id
      LEFT JOIN scout_position_states s ON s.position_id=p.id
      LEFT JOIN scout_position_decisions decision ON decision.id=s.current_decision_id
      LEFT JOIN scout_position_descriptions description ON description.id=(
        SELECT latest.id
        FROM scout_position_descriptions latest
        WHERE latest.position_id=p.id
        ORDER BY latest.created_at DESC,latest.id DESC
        LIMIT 1
      )
      LEFT JOIN scout_description_artifacts artifact ON artifact.id=description.artifact_id
      LEFT JOIN scout_position_promotions promotion
        ON promotion.position_id=p.id
        AND promotion.status='completed'
        AND promotion.gig_id=s.linked_gig_id
      ORDER BY p.id
    `).all() as SelectionRow[];

    const selected: EncodedDescriptionSelectionReport["selected"] = [];
    const excluded: Record<string, number> = {};
    const unresolved: EncodedDescriptionSelectionReport["unresolved"] = [];
    for (const row of rows) {
      if (!isEligible(row)) {
        increment(excluded, "ineligible_state_or_origin");
        continue;
      }

      const artifact = await inspectArtifact(
        input.descriptionsPath,
        row.filePath,
        input.pathHooks?.beforeArtifactFinalOpen,
      );
      if (artifact === "missing") {
        unresolved.push({
          positionId: row.positionId,
          code: "missing_artifact",
        });
        continue;
      }
      if (artifact === "unreadable") {
        unresolved.push({
          positionId: row.positionId,
          code: "unreadable_artifact",
        });
        continue;
      }
      if (artifact === "clean") {
        increment(excluded, "encoded_tag_not_found");
        continue;
      }

      selected.push({
        positionId: row.positionId,
        state: row.state!,
        origin: row.origin,
        linkedGigId: row.linkedGigId,
        company: row.company.slice(0, 200),
      });
    }

    const report: EncodedDescriptionSelectionReport = {
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      complete: unresolved.length === 0,
      selected,
      excluded,
      unresolved,
    };
    await writeReport(
      output,
      report,
      input.pathHooks?.beforeOutputTemporaryOpen,
    );
    return report;
  } finally {
    database.close();
  }
}

function argument(name: string) {
  const index = Bun.argv.indexOf(name);
  return index < 0 ? undefined : Bun.argv[index + 1];
}

if (import.meta.main) {
  const databasePath = argument("--database");
  const descriptionsPath = argument("--descriptions");
  const outputPath = argument("--output");
  if (!databasePath || !descriptionsPath || !outputPath) {
    throw new Error(
      "Usage: bun run scout:encoded-description-selection -- --database <path> --descriptions <path> --output <ignored-json>",
    );
  }
  const report = await writeEncodedDescriptionSelectionReport({
    databasePath,
    descriptionsPath,
    outputPath,
  });
  console.log(JSON.stringify({
    complete: report.complete,
    selected: report.selected.length,
    excluded: Object.values(report.excluded)
      .reduce((total, count) => total + count, 0),
    unresolved: report.unresolved.length,
  }));
}
