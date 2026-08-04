import { readFileSync } from "node:fs";
import { z } from "zod";

const migrationFileSchema = z.object({
  version: z.literal(1),
  meetings: z.array(z.object({
    meetingId: z.string().trim().min(1),
    personIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()),
}).strict();

export interface LegacyMeetingParticipant {
  meetingId: string;
  personId: string;
}

export function loadLegacyMeetingParticipants(filename: string): LegacyMeetingParticipant[] {
  let source: string;
  try {
    source = readFileSync(filename, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid meeting participant migration file: ${filename}`, { cause: error });
  }
  const result = migrationFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid meeting participant migration file: ${filename}`, {
      cause: result.error,
    });
  }
  const participants = result.data.meetings.flatMap(({ meetingId, personIds }) =>
    personIds.map(personId => ({ meetingId, personId })));
  const pairs = new Set(participants.map(({ meetingId, personId }) =>
    JSON.stringify([meetingId, personId])));
  if (pairs.size !== participants.length) {
    throw new Error(`Invalid meeting participant migration file: duplicate mapping in ${filename}`);
  }
  return participants;
}
