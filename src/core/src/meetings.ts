import type { EntityRecord, MeetingData } from "./models";
import { z } from "zod";

export const meetingStatuses = ["confirmed", "completed"] as const;
export type MeetingStatus = typeof meetingStatuses[number];

export interface Meeting extends Omit<MeetingData, "status"> {
  status: MeetingStatus;
  personIds: string[];
}

export type MeetingRecord = EntityRecord<Meeting>;

export const meetingParticipantId = (meetingId: string, personId: string) =>
  `meeting-participant:${[...meetingId].length}:${meetingId}${personId}`;

const meetingTimestampSchema = z.string().datetime({ offset: true });

export function meetingInstant(value: string): number | null {
  if (!meetingTimestampSchema.safeParse(value).success) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}
