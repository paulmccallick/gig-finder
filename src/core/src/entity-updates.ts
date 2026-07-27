import type { Job } from "./jobs";
import type { ChangeContext, RevertedRecord } from "./models";
import type { NetworkContact } from "./network";
import type { Persistence } from "./ports";
import type {
  ContactDomainService,
  JobDomainService,
  MutationOptions,
} from "./tracker-services";
import type {
  JobUpdate,
  NetworkingContactUpdate,
} from "./update-contracts";

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface EntityUpdateResult<T> {
  entity: "job" | "networking_contact";
  changeId: string | null;
  record: T;
  changes: FieldChange[];
}

export interface ChangeRevertResult {
  changeId: string;
  revertedChangeId: string;
  affected: RevertedRecord[];
}

export interface EntityUpdater {
  updateJob(
    context: ChangeContext,
    id: string,
    patch: JobUpdate,
    options?: MutationOptions,
  ): EntityUpdateResult<Job>;
  updateNetworkingContact(
    context: ChangeContext,
    id: string,
    patch: NetworkingContactUpdate,
    options?: MutationOptions,
  ): EntityUpdateResult<NetworkContact>;
  revertChange(
    context: ChangeContext,
    changeId: string,
  ): ChangeRevertResult;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function changedFields(
  before: unknown,
  after: unknown,
  patch: unknown,
  prefix = "",
): FieldChange[] {
  if (isObject(patch) && isObject(before) && isObject(after)) {
    return Object.keys(patch).flatMap(key =>
      changedFields(
        before[key],
        after[key],
        patch[key],
        prefix ? `${prefix}.${key}` : key,
      ));
  }
  return Object.is(before, after) ||
      JSON.stringify(before) === JSON.stringify(after)
    ? []
    : [{ field: prefix, before, after }];
}

const withChangeId = (context: ChangeContext) => ({
  ...context,
  changeId: context.changeId ?? `chg_${crypto.randomUUID()}`,
});

export class EntityUpdateService implements EntityUpdater {
  constructor(
    private readonly persistence: Persistence,
    private readonly jobs: JobDomainService,
    private readonly networking: ContactDomainService,
  ) {}

  updateJob(
    context: ChangeContext,
    id: string,
    patch: JobUpdate,
    options: MutationOptions = {},
  ): EntityUpdateResult<Job> {
    const before = this.jobs.get(id);
    if (!before) throw new Error(`Job not found: ${id}`);
    const change = withChangeId(context);
    const record = this.jobs.update(change, id, patch, options);
    return {
      entity: "job",
      changeId: options.dryRun ? null : change.changeId,
      record,
      changes: changedFields(before, record, patch),
    };
  }

  updateNetworkingContact(
    context: ChangeContext,
    id: string,
    patch: NetworkingContactUpdate,
    options: MutationOptions = {},
  ): EntityUpdateResult<NetworkContact> {
    const before = this.networking.get(id);
    if (!before) throw new Error(`Contact not found: ${id}`);
    const change = withChangeId(context);
    const record = this.networking.update(change, id, patch, options);
    return {
      entity: "networking_contact",
      changeId: options.dryRun ? null : change.changeId,
      record,
      changes: changedFields(before, record, patch),
    };
  }

  revertChange(
    context: ChangeContext,
    targetChangeId: string,
  ): ChangeRevertResult {
    const result = this.persistence.revertChange(
      withChangeId(context),
      targetChangeId,
    );
    return {
      changeId: result.changeId,
      revertedChangeId: targetChangeId,
      affected: result.value,
    };
  }
}
