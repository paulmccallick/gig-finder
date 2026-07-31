import type { AuditPort, Persistence } from "./ports";
import type { BusinessEventInput, ChangeContext, EntityName, EntityRecord, JobPersonData, MeetingData, MeetingParticipantData, Person, PersonData } from "./models";
import {
  jobPersonRelationships,
  type JobPersonRelationship,
  type JobPersonRelationshipType,
} from "./people";
import {
  meetingStatuses,
  type Meeting,
  type MeetingRecord,
  type MeetingStatus,
} from "./meetings";
import {
  matchesQuery,
  normalizedQuery,
  page,
  type JobPersonRelationshipQueryInput,
  type MeetingQueryInput,
  type Page,
  type PageResult,
  type PeopleQueryInput,
  type ReadResult,
} from "./queries";
import type { JobRecord } from "./jobs";
import { DomainValidationError } from "./errors";

export type AuditQuery={resource:"change";id:string}|{resource:"history";entity:EntityName;id:string}|{resource:"events";entityType?:string;entityId?:string};

export class PeopleService {
  constructor(private readonly persistence: Persistence) {}

  get(id: string): Person | null {
    const record = this.persistence.people.get(id);
    return record ? personFromData(record) : null;
  }

  list(): Person[] {
    return this.persistence.people.list().map(personFromData);
  }

  read(id: string): ReadResult<Person> {
    const record = this.get(id);
    return record ? { status: "ok", record } : { status: "not_found", id };
  }

  query(input: PeopleQueryInput): Page<Person> {
    const query = normalizedQuery(input.query);
    return page(
      this.list()
        .filter(person => matchesQuery(query, [person.name, person.company, person.title]))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      input,
    );
  }

  create(context: ChangeContext, person: PersonData): Person {
    return personFromData(
      this.persistence.change(context, transaction => transaction.people.create(person)).value,
    );
  }

  patch(
    context: ChangeContext,
    id: string,
    patch: Partial<Omit<PersonData, "id">>,
    options: { dryRun?: boolean } = {},
  ): Person {
    const current = this.persistence.people.get(id);
    if (!current) throw new Error(`Person not found: ${id}`);
    if (options.dryRun) return { ...personFromData(current), ...patch };
    return personFromData(this.persistence.change(
      context,
      transaction => transaction.people.update(id, current.revision, patch),
    ).value);
  }
}
export class MeetingService {
  constructor(
    private readonly persistence: Persistence,
    private readonly jobs: JobReadService,
    private readonly people: PeopleService,
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
    const records: MeetingRecord[] = [];
    for (const raw of this.persistence.meetings.list()) {
      const result = this.compose(raw);
      if (result.status !== "ok") return result;
      records.push(result.record);
    }
    const query = normalizedQuery(input.query);
    const filtered = records
      .filter(record => input.personIds === undefined
        || record.personIds.some(personId => input.personIds!.includes(personId)))
      .filter(record => input.jobIds === undefined
        || (record.jobId !== null && input.jobIds.includes(record.jobId)))
      .filter(record => input.statuses === undefined || input.statuses.includes(record.status))
      .filter(record => input.startsFrom === undefined || record.startsAt >= input.startsFrom)
      .filter(record => input.startsThrough === undefined || record.startsAt <= input.startsThrough)
      .filter(record => matchesQuery(query, [record.title, record.location, record.description]))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id));
    return { status: "ok", ...page(filtered, input) };
  }

  create(context: ChangeContext, meeting: Meeting): MeetingRecord {
    validateMeeting(meeting, this.jobs, this.people);
    const { personIds, ...data } = meeting;
    this.persistence.change(context, transaction => {
      transaction.meetings.create(data);
      for (const personId of personIds) {
        transaction.meetingParticipants.create(participantData(meeting.id, personId));
      }
    });
    return this.get(meeting.id)!;
  }

  private compose(raw: EntityRecord<MeetingData>): ComposeResult<MeetingRecord> {
    if (!isMeetingStatus(raw.status)) {
      return consistencyFailure(raw.id, `Meeting ${raw.id} has unsupported status ${raw.status}.`);
    }
    if (raw.jobId !== null && this.jobs.read(raw.jobId).status !== "ok") {
      return consistencyFailure(raw.id, `Meeting ${raw.id} references missing job ${raw.jobId}.`);
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
interface JobReadService {
  read(id: string): ReadResult<JobRecord>;
}

export class JobPeopleService {
  constructor(
    private readonly persistence: Persistence,
    private readonly jobs: JobReadService,
    private readonly people: PeopleService,
  ) {}

  get(id: string): JobPersonRelationship | null {
    const raw = this.persistence.jobPeople.get(id);
    return raw ? relationshipFromData(raw) : null;
  }

  list(): JobPersonRelationship[] {
    return this.persistence.jobPeople.list().map(relationshipFromData);
  }

  create(context: ChangeContext, record: JobPersonData): JobPersonRelationship {
    const relationship = relationshipFromData(record);
    return relationshipFromData(this.persistence.change(
      context,
      transaction => transaction.jobPeople.create(relationshipToData(relationship)),
    ).value);
  }

  read(id: string): ReadResult<JobPersonRelationship> {
    const raw = this.persistence.jobPeople.get(id);
    if (!raw) return { status: "not_found", id };
    const relationship = parseRelationship(raw);
    if (!relationship) return unsupportedRelationship(raw);
    return this.validateLinks(relationship) ?? { status: "ok", record: relationship };
  }

  query(input: JobPersonRelationshipQueryInput): PageResult<JobPersonRelationship> {
    const relationships: JobPersonRelationship[] = [];
    for (const raw of this.persistence.jobPeople.list()) {
      const relationship = parseRelationship(raw);
      if (!relationship) return unsupportedRelationship(raw);
      relationships.push(relationship);
    }
    const filtered = relationships
      .filter(record => input.jobIds === undefined || input.jobIds.includes(record.jobId))
      .filter(record => input.personIds === undefined || input.personIds.includes(record.personId))
      .filter(record => input.relationships === undefined || input.relationships.includes(record.relationship))
      .sort((a, b) => a.jobId.localeCompare(b.jobId)
        || a.personId.localeCompare(b.personId)
        || a.relationship.localeCompare(b.relationship)
        || a.id.localeCompare(b.id));
    for (const relationship of filtered) {
      const failure = this.validateLinks(relationship);
      if (failure) return failure;
    }
    return { status: "ok", ...page(filtered, input) };
  }

  peopleForJob(jobId: string, input: PeopleQueryInput = {}): ReadResult<Page<Person>> {
    const job = this.jobs.read(jobId);
    if (job.status !== "ok") return job;
    const related = this.query({ jobIds: [jobId], offset: 0, limit: 50 });
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

  jobsForPerson(personId: string, input: { offset?: number; limit?: number } = {}): ReadResult<Page<JobRecord>> {
    const person = this.people.read(personId);
    if (person.status !== "ok") return person;
    const related = this.query({ personIds: [personId], offset: 0, limit: 50 });
    if (related.status !== "ok") return related;
    const jobs: JobRecord[] = [];
    for (const relationship of related.items) {
      const job = this.jobs.read(relationship.jobId);
      if (job.status !== "ok") {
        return consistencyFailure(
          relationship.id,
          `Relationship ${relationship.id} references missing job ${relationship.jobId}.`,
        );
      }
      jobs.push(job.record);
    }
    return {
      status: "ok",
      record: page(
        jobs.sort((a, b) => a.company.localeCompare(b.company)
          || a.title.localeCompare(b.title)
          || a.id.localeCompare(b.id)),
        input,
      ),
    };
  }

  private validateLinks(
    relationship: JobPersonRelationship,
  ): Extract<ReadResult<never>, { status: "consistency_error" }> | null {
    if (this.jobs.read(relationship.jobId).status !== "ok") {
      return consistencyFailure(
        relationship.id,
        `Relationship ${relationship.id} references missing job ${relationship.jobId}.`,
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

const personFromData = (person: PersonData): Person => ({
  id: person.id,
  name: person.name,
  company: person.company,
  title: person.title,
  linkedInProfileUrl: person.linkedInProfileUrl,
  connectedOn: person.connectedOn,
});

function parseRelationship(record: JobPersonData): JobPersonRelationship | null {
  if (!isJobPersonRelationship(record.relationship)) return null;
  return {
    id: record.id,
    jobId: record.jobId,
    personId: record.personId,
    relationship: record.relationship,
    notes: record.notes,
  };
}

const isJobPersonRelationship = (
  value: string,
): value is JobPersonRelationshipType =>
  jobPersonRelationships.some(relationship => relationship === value);

const isMeetingStatus = (value: string): value is MeetingStatus =>
  meetingStatuses.some(status => status === value);

const participantData = (meetingId: string, personId: string): MeetingParticipantData => ({
  id: `${meetingId}::${personId}`,
  meetingId,
  personId,
});

function validateMeeting(
  meeting: Meeting,
  jobs: JobReadService,
  people: PeopleService,
) {
  if (!meeting.id.trim() || !meeting.title.trim()) {
    throw new DomainValidationError("Meeting id and title are required.");
  }
  if (!isMeetingStatus(meeting.status)) {
    throw new DomainValidationError(`Meeting ${meeting.id} has unsupported status ${meeting.status}.`);
  }
  if (!meeting.startsAt || !meeting.endsAt || meeting.endsAt < meeting.startsAt) {
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
  if (meeting.jobId !== null && jobs.read(meeting.jobId).status !== "ok") {
    throw new DomainValidationError(`Meeting ${meeting.id} references missing job ${meeting.jobId}.`);
  }
}

function relationshipFromData(record: JobPersonData): JobPersonRelationship {
  const relationship = parseRelationship(record);
  if (!relationship) {
    throw new DomainValidationError(
      `Job-person relationship ${record.id} has unsupported relationship ${record.relationship}.`,
    );
  }
  return relationship;
}

const relationshipToData = (record: JobPersonRelationship): JobPersonData => ({
  id: record.id,
  jobId: record.jobId,
  personId: record.personId,
  relationship: record.relationship,
  notes: record.notes,
});

const consistencyFailure = (id: string, message: string) => ({
  status: "consistency_error" as const,
  id,
  message,
});

const unsupportedRelationship = (record: JobPersonData) => consistencyFailure(
  record.id,
  `Relationship ${record.id} has unsupported relationship ${record.relationship}.`,
);
export class HistoryService{constructor(private readonly audit:AuditPort){}change(id:string){return this.audit.query({resource:"change",id})}entity(entity:EntityName,id:string){return this.audit.query({resource:"history",entity,id})}events(entityType?:string,entityId?:string){return this.audit.query({resource:"events",entityType,entityId})}}
