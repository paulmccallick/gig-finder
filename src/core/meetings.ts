import type { EntityRecord } from "./models";
import { z } from "zod";

export const meetingStatuses = ["confirmed", "completed"] as const;
export type MeetingStatus = typeof meetingStatuses[number];

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

const meetingMutableFields={title:z.string().trim().min(1).describe("Meeting title."),startsAt:meetingTimestampSchema.describe("Start timestamp with offset."),endsAt:meetingTimestampSchema.describe("End timestamp with offset."),timezone:meetingTimezoneSchema.describe("IANA timezone."),status:z.enum(meetingStatuses).describe("Meeting status."),personIds:z.array(z.string().trim().min(1)).min(1).describe("Participant Person IDs."),gigId:z.string().trim().min(1).nullable().describe("Related Gig ID, or null."),location:z.string().trim().nullable().describe("Location, or null."),description:z.string().trim().nullable().describe("Description, or null.")};
export const meetingEntitySchema=z.object({id:z.string().trim().min(1),...meetingMutableFields,externalCalendarId:z.string().nullable(),externalEventId:z.string().nullable()}).strict();
export const meetingInputSchema=z.object({title:meetingMutableFields.title.optional(),startsAt:meetingMutableFields.startsAt.optional(),endsAt:meetingMutableFields.endsAt.optional(),timezone:meetingMutableFields.timezone.optional(),status:meetingMutableFields.status.optional(),personIds:meetingMutableFields.personIds.optional(),gigId:meetingMutableFields.gigId.optional(),location:meetingMutableFields.location.optional(),description:meetingMutableFields.description.optional()}).strict().refine(value=>Object.keys(value).length>0,"Meeting input must contain at least one field.");
export type Meeting=z.infer<typeof meetingEntitySchema>;
export type MeetingInput=z.infer<typeof meetingInputSchema>;
export type MeetingRecord = EntityRecord<Meeting>;
export const meetingInputFieldPaths=["title","startsAt","endsAt","timezone","status","personIds","gigId","location","description"] as const;
export const meetingClearableInputFieldPaths=new Set<typeof meetingInputFieldPaths[number]>(["gigId","location","description"]);

export function meetingInstant(value: string): number | null {
  if (!meetingTimestampSchema.safeParse(value).success) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}
