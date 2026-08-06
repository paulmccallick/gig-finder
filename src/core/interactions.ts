import { z } from "zod";
import type { EntityRecord } from "./models";

export const interactionKinds = ["message", "call", "meeting", "interview", "conversation", "other"] as const;
export const interactionChannels = ["email", "linkedin", "sms", "chat", "phone", "video", "in_person", "other"] as const;
export const interactionDirections = ["inbound", "outbound", "mutual", "unknown"] as const;
export const interactionStatuses = ["planned", "confirmed", "completed", "canceled", "no_show"] as const;
export type InteractionKind = typeof interactionKinds[number];
export type InteractionChannel = typeof interactionChannels[number];
export type InteractionDirection = typeof interactionDirections[number];
export type InteractionStatus = typeof interactionStatuses[number];

export const interactionParticipantId = (interactionId: string, personId: string) =>
  `interaction-participant:${interactionId.length}:${interactionId}${personId}`;
export const interactionTimestampSchema = z.string().datetime({ offset: true });
export const interactionTimezoneSchema = z.string().trim().min(1).refine(value => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; }
  catch { return false; }
}, "Must be a valid IANA timezone.");
const nullableText = z.string().trim().nullable();
const fields = {
  subject: z.string().trim().min(1).describe("Human-readable interaction subject."),
  kind: z.enum(interactionKinds), channel: z.enum(interactionChannels), direction: z.enum(interactionDirections),
  status: z.enum(interactionStatuses), startsAt: interactionTimestampSchema,
  endsAt: interactionTimestampSchema.nullable(), timezone: interactionTimezoneSchema.nullable(),
  location: nullableText, summary: nullableText, notes: nullableText,
  personIds: z.array(z.string().trim().min(1)).min(1).refine(value => new Set(value).size === value.length, "Person IDs must be unique."),
  gigId: z.string().trim().min(1).nullable(), supersedesInteractionId: z.string().trim().min(1).nullable(),
  originChangeId: z.string().trim().min(1).nullable(), structuredData: z.record(z.string(), z.unknown()),
};
export const interactionEntitySchema = z.object({ id: z.string().trim().min(1), ...fields }).strict().superRefine((value, ctx) => {
  if (value.endsAt && Date.parse(value.endsAt) < Date.parse(value.startsAt)) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must not precede start." });
  if (value.supersedesInteractionId === value.id) ctx.addIssue({ code: "custom", path: ["supersedesInteractionId"], message: "An Interaction cannot supersede itself." });
});
export const interactionInputSchema = z.object(Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()])) as { [K in keyof typeof fields]: z.ZodOptional<(typeof fields)[K]> }).strict().refine(value => Object.keys(value).length > 0, "Interaction input must contain at least one field.");
export type Interaction = z.infer<typeof interactionEntitySchema>;
export type InteractionInput = z.infer<typeof interactionInputSchema>;
export type InteractionRecord = EntityRecord<Interaction>;
export type InteractionReference = Pick<Interaction,"id"|"subject"|"kind"|"channel"|"status"|"startsAt">;
export const interactionInputFieldPaths = Object.keys(fields) as Array<keyof InteractionInput & string>;
export const interactionClearableInputFieldPaths = new Set<string>(["endsAt", "timezone", "location", "summary", "notes", "gigId", "supersedesInteractionId", "originChangeId"]);
export const interactionInstant = (value: string) => interactionTimestampSchema.safeParse(value).success ? Date.parse(value) : null;

export interface InteractionSource {
  id: string; interactionId: string; sourceSystem: string; externalId: string | null;
  sourceTimestamp: string | null; sourceUri: string | null; importedAt: string;
  contentHash: string | null; excerpt: string | null; originChangeId: string | null;
}
export interface InteractionLegacyRef { id: string; interactionId: string; legacyType: "meeting" | "person_last_contact"; legacyId: string; legacyRevision: number | null; originChangeId: string | null }
