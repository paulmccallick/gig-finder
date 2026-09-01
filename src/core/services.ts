import type { AuditPort, Persistence } from "./ports";
import type { ChangeContext, EntityName, EntityRecord, GigPersonData, PersonData } from "./models";
import {
  comparePeople,
  personPriorities,
  personStatuses,
  gigPersonRelationships,
  type GigPersonRelationship,
  type GigPersonRelationshipType,
  type Person,
  type PersonRecord,
  relationshipStrengths,
  personInputSchema,
  type PersonInput,
} from "./people";
import {
  matchesQuery,
  normalizedQuery,
  page,
  type GigPersonRelationshipQueryInput,
  type Page,
  type PageResult,
  type PeopleQueryInput,
  type ReadResult,
} from "./queries";
import type { GigRecord } from "./gigs";
import { DomainValidationError, MutationError } from "./errors";
import type { ManagedDocumentService } from "./managed-document-service";
import { ChangeExecutor, creationPayloadHash, type MutationOptions, type MutationResult } from "./changes";
import { deepPatch } from "./deep-patch";
import { gigPersonRelationshipEntitySchema, gigPersonRelationshipInputSchema, type GigPersonRelationshipInput } from "./gig-people";

type PersonRelationshipData = Pick<PersonData,
  "relationshipType" | "relationshipStrength" | "introducedBy" | "relationshipNotes"
  | "priority" | "status" | "whyInteresting" | "notesJson" | "tagsJson">;
export type PersonCreateInput = Omit<PersonData, keyof PersonRelationshipData> & Partial<PersonRelationshipData>;

export class PeopleService {
  constructor(
    private readonly persistence: Persistence,
    private readonly changes: ChangeExecutor,
    private readonly documents: ManagedDocumentService,
  ) {}

  private record(record: EntityRecord<PersonData>): PersonRecord {
    const documents = this.documents.summaries("person", record.id);
    const participantIds=new Set(this.persistence.interactionParticipants.list().filter(item=>item.personId===record.id).map(item=>item.interactionId));
    const latest=this.persistence.interactions.list().filter(item=>participantIds.has(item.id)&&item.status==="completed").sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt)||a.id.localeCompare(b.id))[0];
    const interactions=this.persistence.interactions.list().filter(item=>participantIds.has(item.id)).sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt)||a.id.localeCompare(b.id)).map(item=>({id:item.id,subject:item.subject,kind:item.kind as import("./interactions").InteractionKind,channel:item.channel as import("./interactions").InteractionChannel,status:item.status as import("./interactions").InteractionStatus,startsAt:item.startsAt}));
    return personFromData(record,documents,latest?{date:interactionCalendarDate(latest.startsAt,latest.timezone),method:latest.channel,summary:latest.summary??latest.notes??latest.subject}:undefined,interactions);
  }

  get(id: string): PersonRecord | null {
    const record = this.persistence.people.get(id);
    return record ? this.record(record) : null;
  }

  list(): PersonRecord[] {
    return this.persistence.people.list().map(record => this.record(record));
  }

  read(id: string): ReadResult<PersonRecord> {
    const record = this.get(id);
    return record ? { status: "ok", record } : { status: "not_found", id };
  }

  query(input: PeopleQueryInput): Page<PersonRecord> {
    const query = normalizedQuery(input.query);
    return page(
      this.list()
        .filter(person => input.statuses === undefined || input.statuses.includes(person.status))
        .filter(person => input.priorities === undefined || input.priorities.includes(person.priority))
        .filter(person => input.relationshipStrengths === undefined || input.relationshipStrengths.includes(person.relationship.strength))
        .filter(person => matchesQuery(query, [person.name, person.company, person.title, person.whyInteresting]))
        .sort((a, b) => comparePeople(a, b) || a.id.localeCompare(b.id)),
      input,
    );
  }

  create(context: ChangeContext, person: PersonCreateInput, options: MutationOptions = {}): PersonRecord {
    const data = withPersonDefaults(person);
    const preview = { ...data, revision: 1, isDeleted: false, createdAt: context.occurredAt ?? new Date().toISOString(), updatedAt: context.occurredAt ?? new Date().toISOString() };
    validatePerson(personFromData(preview, []));
    if (options.dryRun) return personFromData(preview, []);
    return this.record(this.persistence.change(context, transaction => transaction.people.create(data)).value);
  }

  createNew(context: ChangeContext, id: string, input: PersonInput, options: MutationOptions = {}): MutationResult<PersonRecord> {
    const parsed = personInputSchema.parse(input);
    const person: PersonCreateInput = {
      id,name:parsed.name??"",company:parsed.company??null,title:parsed.title??null,linkedInProfileUrl:parsed.linkedInProfileUrl??null,connectedOn:parsed.connectedOn??null,
      ...(parsed.relationship?.type===undefined?{}:{relationshipType:parsed.relationship.type}),...(parsed.relationship?.strength===undefined?{}:{relationshipStrength:parsed.relationship.strength}),introducedBy:parsed.relationship?.introducedBy??null,relationshipNotes:parsed.relationship?.notes??null,
      ...(parsed.priority===undefined?{}:{priority:parsed.priority}),...(parsed.status===undefined?{}:{status:parsed.status}),whyInteresting:parsed.whyInteresting??null,notesJson:JSON.stringify(parsed.notes??[]),tagsJson:JSON.stringify(parsed.tags??[]),
    };
    const data=withPersonDefaults(person), timestamp=context.occurredAt??new Date().toISOString();
    const candidate=personFromData({...data,revision:1,isDeleted:false,createdAt:timestamp,updatedAt:timestamp},[]);
    validatePerson(candidate);
    const payloadHash=creationPayloadHash(data);
    if(context.changeId){
      const fingerprint=this.persistence.creationFingerprint(context.changeId);
      if(fingerprint){const existing=this.get(id);if(fingerprint.entityType!=="person"||fingerprint.entityId!==id||fingerprint.payloadHash!==payloadHash||!existing)throw new MutationError("revision_conflict",`Change ${context.changeId} does not match Person ${id} and payload.`);return{record:existing,changeId:context.changeId};}
      if(this.persistence.hasChange(context.changeId))throw new MutationError("revision_conflict",`Change ${context.changeId} does not match Person ${id} and payload.`);
    }
    const duplicate=this.persistence.people.list().find(record=>(parsed.linkedInProfileUrl!==undefined&&parsed.linkedInProfileUrl!==null&&record.linkedInProfileUrl===parsed.linkedInProfileUrl)||(record.name.trim().toLocaleLowerCase()===(parsed.name??"").toLocaleLowerCase()&&(record.company??"").trim().toLocaleLowerCase()===(parsed.company??"").toLocaleLowerCase()));
    if(duplicate)throw new MutationError("duplicate",`Person already exists: ${duplicate.id}`);
    return this.changes.execute(context,candidate,options,transaction=>{transaction.recordCreationFingerprint("person",id,payloadHash);return this.record(transaction.people.create(data))});
  }

  update(
    context: ChangeContext,
    id: string,
    patch: PersonInput,
    options: MutationOptions = {},
  ) {
    const validatedPatch = personInputSchema.parse(patch);
    const raw = this.persistence.people.get(id);
    if (!raw) throw new Error(`Person not found: ${id}`);
    const updated = deepPatch(this.record(raw), validatedPatch);
    updated.profileStatus = updated.linkedInProfileUrl ? "verified" : "missing";
    validatePerson(updated);
    const data = personToData(updated);
    const { id: _, ...fields } = data;
    return this.changes.execute(context, updated, options, transaction =>
      this.record(transaction.people.update(id, raw.revision, fields)));
  }

}
/* Legacy Meeting services were removed by migration 0021. Business Events
remain preserved legacy storage without public runtime capabilities.
export class MeetingService {
  constructor(
    private readonly persistence: Persistence,
    private readonly gigs: GigReadService,
    private readonly people: PeopleService,
    private readonly changes: ChangeExecutor,
  ) {}

  get(id: string): MeetingRecord | null {
    const result = this.read(id);
    if (result.status === "not_found") return null;
    if (result.status === "consistency_error") throw new DomainValidationError(result.message);
    return result.record;
  }

  list(): MeetingRecord[] {
    return this.persistence.meetings.list().map(raw => {
      const result = this.compose(raw);
      if (result.status === "consistency_error") throw new DomainValidationError(result.message);
      return result.record;
    });
  }

  read(id: string): ReadResult<MeetingRecord> {
    const raw = this.persistence.meetings.get(id);
    return raw ? this.compose(raw) : { status: "not_found", id };
  }

  query(input: MeetingQueryInput): PageResult<MeetingRecord> {
    const startsFrom = queryInstant(input.startsFrom, "startsFrom");
    const startsThrough = queryInstant(input.startsThrough, "startsThrough");
    if (startsFrom !== undefined && startsThrough !== undefined && startsFrom > startsThrough) {
      throw new DomainValidationError("Meeting startsFrom must not be after startsThrough.");
    }
    const records: Array<{ record: MeetingRecord; startsAt: number }> = [];
    for (const raw of this.persistence.meetings.list()) {
      const result = this.compose(raw);
      if (result.status !== "ok") return result;
      const startsAt = meetingInstant(result.record.startsAt);
      if (startsAt === null) {
        return consistencyFailure(raw.id, `Meeting ${raw.id} has an invalid startsAt timestamp.`);
      }
      records.push({ record: result.record, startsAt });
    }
    const query = normalizedQuery(input.query);
    const filtered = records
      .filter(({ record }) => input.personIds === undefined
        || record.personIds.some(personId => input.personIds?.includes(personId)))
      .filter(({ record }) => input.gigIds === undefined
        || (record.gigId !== null && input.gigIds.includes(record.gigId)))
      .filter(({ record }) => input.statuses === undefined || input.statuses.includes(record.status))
      .filter(({ startsAt }) => startsFrom === undefined || startsAt >= startsFrom)
      .filter(({ startsAt }) => startsThrough === undefined || startsAt <= startsThrough)
      .filter(({ record }) => matchesQuery(query, [record.title, record.location, record.description]))
      .sort((a, b) => b.startsAt - a.startsAt || a.record.id.localeCompare(b.record.id))
      .map(({ record }) => record);
    return { status: "ok", ...page(filtered, input) };
  }

  create(context: ChangeContext, meeting: Meeting): MutationResult<MeetingRecord> {
    validateMeeting(meeting, this.gigs, this.people);
    const {id,externalCalendarId,externalEventId,...input}=meeting;
    const parsed=meetingInputSchema.parse(input);
    const candidate={id,externalCalendarId,externalEventId,...parsed} as Meeting;
    const { personIds, ...data } = candidate;
    const result = this.persistence.change(context, transaction => {
      const record = transaction.meetings.create(data);
      for (const personId of personIds) {
        transaction.meetingParticipants.create(participantData(meeting.id, personId));
      }
      return {
        ...record,
        status: candidate.status,
        personIds: [...personIds].sort(),
      };
    });
    return { changeId: result.changeId, record: result.value };
  }

  update(
    context: ChangeContext,
    id: string,
    patch: MeetingInput,
    options: MutationOptions = {},
  ): MutationResult<MeetingRecord> {
    const validatedPatch = meetingInputSchema.parse(patch);
    const current = this.get(id);
    if (!current) throw new Error(`Meeting not found: ${id}`);
    const candidate: MeetingRecord = {
      ...current,
      ...validatedPatch,
      personIds: [...(validatedPatch.personIds ?? current.personIds)].sort(),
    };
    validateMeeting(candidate, this.gigs, this.people);

    const raw = this.persistence.meetings.get(id)!;
    const participants = this.persistence.meetingParticipants.list()
      .filter(participant => participant.meetingId === id);
    const currentParticipantIds = new Set(participants.map(participant => participant.personId));
    const candidateParticipantIds = new Set(candidate.personIds);
    const { personIds: _, ...meetingPatch } = validatedPatch;

    return this.changes.execute(context, candidate, options, transaction => {
      const persisted = Object.keys(meetingPatch).length > 0
        ? transaction.meetings.update(id, raw.revision, meetingPatch)
        : transaction.meetings.touch(id, raw.revision);
      for (const participant of participants) {
        if (!candidateParticipantIds.has(participant.personId)) {
          transaction.meetingParticipants.delete(participant.id, participant.revision);
        }
      }
      for (const personId of candidate.personIds) {
        if (!currentParticipantIds.has(personId)) {
          const participant = participantData(id, personId);
          const previous = this.persistence.meetingParticipants.get(
            participant.id,
            { includeDeleted: true },
          );
          if (previous?.isDeleted) {
            transaction.meetingParticipants.restore(
              participant.id,
              previous.revision,
              { meetingId: id, personId },
            );
          } else {
            transaction.meetingParticipants.create(participant, { reversible: true });
          }
        }
      }
      return {
        ...persisted,
        status: candidate.status,
        personIds: candidate.personIds,
      };
    });
  }

  private compose(raw: EntityRecord<MeetingData>): ComposeResult<MeetingRecord> {
    if (!isMeetingStatus(raw.status)) {
      return consistencyFailure(raw.id, `Meeting ${raw.id} has unsupported status ${raw.status}.`);
    }
    const startsAt = meetingInstant(raw.startsAt);
    const endsAt = meetingInstant(raw.endsAt);
    if (startsAt === null || endsAt === null) {
      return consistencyFailure(raw.id, `Meeting ${raw.id} has an invalid timestamp.`);
    }
    if (endsAt < startsAt) {
      return consistencyFailure(raw.id, `Meeting ${raw.id} ends before it starts.`);
    }
    if (raw.gigId !== null && this.gigs.read(raw.gigId).status !== "ok") {
      return consistencyFailure(raw.id, `Meeting ${raw.id} references missing gig ${raw.gigId}.`);
    }
    const participants = this.persistence.meetingParticipants.list()
      .filter(participant => participant.meetingId === raw.id)
      .sort((a, b) => a.personId.localeCompare(b.personId));
    if (participants.length === 0) {
      return consistencyFailure(raw.id, `Meeting ${raw.id} has no participants.`);
    }
    for (const participant of participants) {
      if (this.people.read(participant.personId).status !== "ok") {
        return consistencyFailure(
          raw.id,
          `Meeting ${raw.id} references missing person ${participant.personId}.`,
        );
      }
    }
    return {
      status: "ok",
      record: {
        ...raw,
        status: raw.status,
        personIds: participants.map(participant => participant.personId),
      },
    };
  }
}

type ComposeResult<T> =
  | { status: "ok"; record: T }
  | { status: "consistency_error"; id: string; message: string };
export class EventService{constructor(private readonly persistence:Persistence){}record(context:ChangeContext,event:BusinessEventInput){return this.persistence.change(context,u=>u.recordEvent(event)).value}}
*/
interface GigReadService {
  read(id: string): ReadResult<GigRecord>;
}

export class GigPeopleService {
  constructor(
    private readonly persistence: Persistence,
    private readonly gigs: GigReadService,
    private readonly people: PeopleService,
  ) {}

  get(id: string): GigPersonRelationship | null {
    const raw = this.persistence.gigPeople.get(id);
    return raw ? relationshipFromData(raw) : null;
  }

  list(): GigPersonRelationship[] {
    return this.persistence.gigPeople.list().map(relationshipFromData);
  }

  create(context: ChangeContext, record: GigPersonData): GigPersonRelationship {
    const relationship = relationshipFromData(record);
    return relationshipFromData(this.persistence.change(
      context,
      transaction => transaction.gigPeople.create(relationshipToData(relationship)),
    ).value);
  }

  createNew(context: ChangeContext, id: string, input: GigPersonRelationshipInput, options: MutationOptions = {}): MutationResult<GigPersonRelationship> {
    const entity=gigPersonRelationshipEntitySchema.safeParse({id,...gigPersonRelationshipInputSchema.parse(input)});
    if(!entity.success)throw new DomainValidationError(entity.error.issues.map(issue=>issue.message).join("; "));
    const parsed=entity.data;
    const payloadHash=creationPayloadHash(relationshipToData(parsed));
    if(context.changeId){
      const fingerprint=this.persistence.creationFingerprint(context.changeId);
      if(fingerprint){const existing=this.get(id);if(fingerprint.entityType!=="gig-person"||fingerprint.entityId!==id||fingerprint.payloadHash!==payloadHash||!existing)throw new MutationError("revision_conflict",`Change ${context.changeId} does not match relationship ${id} and payload.`);return{record:existing,changeId:context.changeId};}
      if(this.persistence.hasChange(context.changeId))throw new MutationError("revision_conflict",`Change ${context.changeId} does not match relationship ${id} and payload.`);
    }
    if(this.gigs.read(parsed.gigId).status!=="ok")throw new MutationError("not_found",`Gig not found: ${parsed.gigId}`);
    if(this.people.read(parsed.personId).status!=="ok")throw new MutationError("not_found",`Person not found: ${parsed.personId}`);
    const duplicate=this.persistence.gigPeople.list().find(item=>item.gigId===parsed.gigId&&item.personId===parsed.personId&&item.relationship===parsed.relationship);
    if(duplicate)throw new MutationError("duplicate",`Relationship already exists: ${duplicate.id}`);
    const candidate: GigPersonRelationship=parsed;
    if(options.dryRun)return{record:candidate,changeId:null};
    try{
      const result=this.persistence.change(context,transaction=>{transaction.recordCreationFingerprint("gig-person",id,payloadHash);return transaction.gigPeople.create(relationshipToData(candidate),{reversible:true})});
      return{record:relationshipFromData(result.value),changeId:result.changeId};
    }catch(error){
      if(error instanceof Error&&(error.message.includes("gig_people_relation_idx")||error.message.includes("UNIQUE constraint failed: gig_people.gig_id, gig_people.person_id, gig_people.relationship")))throw new MutationError("duplicate","Relationship already exists.",{cause:error});
      throw error;
    }
  }

  read(id: string): ReadResult<GigPersonRelationship> {
    const raw = this.persistence.gigPeople.get(id);
    if (!raw) return { status: "not_found", id };
    const relationship = parseRelationship(raw);
    if (!relationship) return unsupportedRelationship(raw);
    return this.validateLinks(relationship) ?? { status: "ok", record: relationship };
  }

  query(input: GigPersonRelationshipQueryInput): PageResult<GigPersonRelationship> {
    const relationships: GigPersonRelationship[] = [];
    for (const raw of this.persistence.gigPeople.list()) {
      const relationship = parseRelationship(raw);
      if (!relationship) return unsupportedRelationship(raw);
      relationships.push(relationship);
    }
    const filtered = relationships
      .filter(record => input.gigIds === undefined || input.gigIds.includes(record.gigId))
      .filter(record => input.personIds === undefined || input.personIds.includes(record.personId))
      .filter(record => input.relationships === undefined || input.relationships.includes(record.relationship))
      .sort((a, b) => a.gigId.localeCompare(b.gigId)
        || a.personId.localeCompare(b.personId)
        || a.relationship.localeCompare(b.relationship)
        || a.id.localeCompare(b.id));
    for (const relationship of filtered) {
      const failure = this.validateLinks(relationship);
      if (failure) return failure;
    }
    return { status: "ok", ...page(filtered, input) };
  }

  peopleForGig(gigId: string, input: PeopleQueryInput = {}): ReadResult<Page<Person>> {
    const gig = this.gigs.read(gigId);
    if (gig.status !== "ok") return gig;
    const related = this.query({ gigIds: [gigId], offset: 0, limit: 50 });
    if (related.status !== "ok") return related;
    const people: Person[] = [];
    for (const relationship of related.items) {
      const person = this.people.read(relationship.personId);
      if (person.status !== "ok") {
        return consistencyFailure(
          relationship.id,
          `Relationship ${relationship.id} references missing person ${relationship.personId}.`,
        );
      }
      people.push(person.record);
    }
    const query = normalizedQuery(input.query);
    return {
      status: "ok",
      record: page(
        people
          .filter(person => matchesQuery(query, [person.name, person.company, person.title]))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        input,
      ),
    };
  }

  gigsForPerson(personId: string, input: { offset?: number; limit?: number } = {}): ReadResult<Page<GigRecord>> {
    const person = this.people.read(personId);
    if (person.status !== "ok") return person;
    const related = this.query({ personIds: [personId], offset: 0, limit: 50 });
    if (related.status !== "ok") return related;
    const gigs: GigRecord[] = [];
    for (const relationship of related.items) {
      const gig = this.gigs.read(relationship.gigId);
      if (gig.status !== "ok") {
        return consistencyFailure(
          relationship.id,
          `Relationship ${relationship.id} references missing gig ${relationship.gigId}.`,
        );
      }
      gigs.push(gig.record);
    }
    return {
      status: "ok",
      record: page(
        gigs.sort((a, b) => a.company.localeCompare(b.company)
          || a.title.localeCompare(b.title)
          || a.id.localeCompare(b.id)),
        input,
      ),
    };
  }

  private validateLinks(
    relationship: GigPersonRelationship,
  ): Extract<ReadResult<never>, { status: "consistency_error" }> | null {
    if (this.gigs.read(relationship.gigId).status !== "ok") {
      return consistencyFailure(
        relationship.id,
        `Relationship ${relationship.id} references missing gig ${relationship.gigId}.`,
      );
    }
    if (this.people.read(relationship.personId).status !== "ok") {
      return consistencyFailure(
        relationship.id,
        `Relationship ${relationship.id} references missing person ${relationship.personId}.`,
      );
    }
    return null;
  }
}

const personDefaults: PersonRelationshipData = {
  relationshipType: "professional_contact",
  relationshipStrength: "unknown",
  introducedBy: null,
  relationshipNotes: null,
  priority: "unranked",
  status: "not_contacted",
  whyInteresting: null,
  notesJson: "[]",
  tagsJson: "[]",
};

const withPersonDefaults = (person: PersonCreateInput): PersonData => ({
  ...personDefaults,
  ...person,
});

const personFromData = (
  person: EntityRecord<PersonData>,
  documents: PersonRecord["documents"],
  lastContact?:{date:string;method:string;summary:string},
  interactions:PersonRecord["interactions"]=[],
): PersonRecord => ({
  id: person.id,
  name: person.name,
  company: person.company,
  title: person.title,
  linkedInProfileUrl: person.linkedInProfileUrl,
  profileStatus: person.linkedInProfileUrl ? "verified" : "missing",
  connectedOn: person.connectedOn,
  relationship: {
    type: person.relationshipType,
    strength: person.relationshipStrength as Person["relationship"]["strength"],
    introducedBy: person.introducedBy,
    notes: person.relationshipNotes,
  },
  priority: person.priority as Person["priority"],
  status: person.status as Person["status"],
  lastContacted: lastContact?.date??null,
  lastContactMethod: lastContact?.method??null,
  lastContactSummary: lastContact?.summary??null,
  whyInteresting: person.whyInteresting,
  notes: JSON.parse(person.notesJson) as string[],
  tags: JSON.parse(person.tagsJson) as string[],
  createdAt: person.createdAt.slice(0, 10),
  updatedAt: person.updatedAt.slice(0, 10),
  hasProfile: documents.some(document => document.type === "profile"),
  documents,
  interactions,
});

const personToData = (person: Person): PersonData => ({
  id: person.id,
  name: person.name,
  company: person.company,
  title: person.title,
  linkedInProfileUrl: person.linkedInProfileUrl,
  connectedOn: person.connectedOn,
  relationshipType: person.relationship.type,
  relationshipStrength: person.relationship.strength,
  introducedBy: person.relationship.introducedBy,
  relationshipNotes: person.relationship.notes,
  priority: person.priority,
  status: person.status,
  whyInteresting: person.whyInteresting,
  notesJson: JSON.stringify(person.notes),
  tagsJson: JSON.stringify(person.tags),
});

const personDatePattern = /^\d{4}-\d{2}-\d{2}$/;
function interactionCalendarDate(startsAt:string,timezone:string|null):string {
  if(timezone===null)return startsAt.slice(0,10);
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(startsAt));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validatePerson(person: Person) {
  if (!person.id.trim() || !person.name.trim()) throw new DomainValidationError("Person id and name are required.");
  if (!personPriorities.includes(person.priority)
    || !personStatuses.includes(person.status)
    || !relationshipStrengths.includes(person.relationship.strength)) {
    throw new DomainValidationError(`Person ${person.id} has invalid relationship state.`);
  }
  for (const [value, label] of [
    [person.connectedOn, "connectedOn"],
    [person.lastContacted, "lastContacted"],
  ] as const) {
    if (value !== null && !personDatePattern.test(value)) {
      throw new DomainValidationError(`Person ${person.id} ${label} must use YYYY-MM-DD.`);
    }
  }
  if (person.linkedInProfileUrl && !/^https:\/\/(www\.)?linkedin\.com\/in\//.test(person.linkedInProfileUrl)) {
    throw new DomainValidationError(`Person ${person.id} has an invalid LinkedIn profile URL.`);
  }
}

function parseRelationship(record: GigPersonData): GigPersonRelationship | null {
  if (!isGigPersonRelationship(record.relationship)) return null;
  return {
    id: record.id,
    gigId: record.gigId,
    personId: record.personId,
    relationship: record.relationship,
    notes: record.notes,
  };
}

const isGigPersonRelationship = (
  value: string,
): value is GigPersonRelationshipType =>
  gigPersonRelationships.some(relationship => relationship === value);

/* Legacy validation helpers retained only as migration mapping reference.
const isMeetingStatus = (value: string): value is MeetingStatus =>
  meetingStatuses.some(status => status === value);

const participantData = (meetingId: string, personId: string): MeetingParticipantData => ({
  id: meetingParticipantId(meetingId, personId),
  meetingId,
  personId,
});

function validateMeeting(
  meeting: Meeting,
  gigs: GigReadService,
  people: PeopleService,
) {
  if (!meeting.id.trim() || !meeting.title.trim()) {
    throw new DomainValidationError("Meeting id and title are required.");
  }
  if (!meetingTimezoneSchema.safeParse(meeting.timezone).success) {
    throw new DomainValidationError(`Meeting ${meeting.id} timezone must be a valid IANA timezone.`);
  }
  if (!isMeetingStatus(meeting.status)) {
    throw new DomainValidationError(`Meeting ${meeting.id} has unsupported status ${meeting.status}.`);
  }
  const startsAt = meetingInstant(meeting.startsAt);
  const endsAt = meetingInstant(meeting.endsAt);
  if (startsAt === null || endsAt === null) {
    throw new DomainValidationError(`Meeting ${meeting.id} requires valid ISO 8601 timestamps.`);
  }
  if (endsAt < startsAt) {
    throw new DomainValidationError(`Meeting ${meeting.id} must end at or after it starts.`);
  }
  const personIds = [...new Set(meeting.personIds)];
  if (personIds.length === 0) {
    throw new DomainValidationError(`Meeting ${meeting.id} requires at least one participant.`);
  }
  if (personIds.length !== meeting.personIds.length) {
    throw new DomainValidationError(`Meeting ${meeting.id} contains duplicate participants.`);
  }
  for (const personId of personIds) {
    if (people.read(personId).status !== "ok") {
      throw new DomainValidationError(`Meeting ${meeting.id} references missing person ${personId}.`);
    }
  }
  if (meeting.gigId !== null && gigs.read(meeting.gigId).status !== "ok") {
    throw new DomainValidationError(`Meeting ${meeting.id} references missing gig ${meeting.gigId}.`);
  }
}

function queryInstant(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  const instant = meetingInstant(value);
  if (instant === null) {
    throw new DomainValidationError(`Meeting ${field} must be a valid ISO 8601 timestamp.`);
  }
  return instant;
}
*/

function relationshipFromData(record: GigPersonData): GigPersonRelationship {
  const relationship = parseRelationship(record);
  if (!relationship) {
    throw new DomainValidationError(
      `Gig-person relationship ${record.id} has unsupported relationship ${record.relationship}.`,
    );
  }
  return relationship;
}

const relationshipToData = (record: GigPersonRelationship): GigPersonData => ({
  id: record.id,
  gigId: record.gigId,
  personId: record.personId,
  relationship: record.relationship,
  notes: record.notes,
});

const consistencyFailure = (id: string, message: string) => ({
  status: "consistency_error" as const,
  id,
  message,
});

const unsupportedRelationship = (record: GigPersonData) => consistencyFailure(
  record.id,
  `Relationship ${record.id} has unsupported relationship ${record.relationship}.`,
);
export class HistoryService{constructor(private readonly audit:AuditPort){}change(id:string){return this.audit.query({resource:"change",id})}entity(entity:EntityName,id:string){return this.audit.query({resource:"history",entity,id})}}
