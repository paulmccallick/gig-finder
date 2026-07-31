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

export const meetingTimezoneSchema = z.string().trim().min(1).refine(value => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "Must be a valid IANA timezone.");

export function meetingInstant(value: string): number | null {
  if (!meetingTimestampSchema.safeParse(value).success) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}
