import type { EntityRecord, MeetingData } from "./models";

export const meetingStatuses = ["confirmed", "completed"] as const;
export type MeetingStatus = typeof meetingStatuses[number];

export interface Meeting extends Omit<MeetingData, "status"> {
  status: MeetingStatus;
  personIds: string[];
}

export type MeetingRecord = EntityRecord<Meeting>;
