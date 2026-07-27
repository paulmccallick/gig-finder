import type { Job } from "./jobs";
import type { NetworkContact } from "./network";
import type { Persistence } from "./ports";
import type {
  JobUpdate,
  NetworkingContactUpdate,
} from "./update-contracts";
import type {
  ContactDomainService,
  JobDomainService,
} from "./tracker-services";

export interface AgentMutationContext {
  actor: string;
  requestId: string;
  toolCallId: string;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AgentUpdateResult<T> {
  status: "ok";
  entity: "job" | "networking_contact";
  changeId: string;
  record: T;
  changes: FieldChange[];
}

export interface AgentRevertResult {
  status: "ok";
  entity: "agent_change";
  changeId: string;
  revertedChangeId: string;
  affected: Array<{ entity: string; id: string }>;
}

export interface AgentMutationWriter {
  updateJob(
    context: AgentMutationContext,
    id: string,
    patch: JobUpdate,
  ): AgentUpdateResult<Job>;
  updateNetworkingContact(
    context: AgentMutationContext,
    id: string,
    patch: NetworkingContactUpdate,
  ): AgentUpdateResult<NetworkContact>;
  revertAgentChange(
    context: AgentMutationContext,
    changeId: string,
  ): AgentRevertResult;
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

const updateChangeId = (toolCallId: string) => `agent-tool:${toolCallId}`;
const revertChangeId = (toolCallId: string) => `agent-revert:${toolCallId}`;

export class JobSearchMutationService implements AgentMutationWriter {
  constructor(
    private readonly persistence: Persistence,
    private readonly jobs: JobDomainService,
    private readonly networking: ContactDomainService,
  ) {}

  updateJob(
    context: AgentMutationContext,
    id: string,
    patch: JobUpdate,
  ): AgentUpdateResult<Job> {
    const before = this.jobs.get(id);
    if (!before) throw new Error(`Job not found: ${id}`);
    const changeId = updateChangeId(context.toolCallId);
    const record = this.jobs.update({
      actor: context.actor,
      source: "agent",
      summary: `Agent updated job ${id} (request ${context.requestId}, tool ${context.toolCallId})`,
      changeId,
    }, id, patch);
    return {
      status: "ok",
      entity: "job",
      changeId,
      record,
      changes: changedFields(before, record, patch),
    };
  }

  updateNetworkingContact(
    context: AgentMutationContext,
    id: string,
    patch: NetworkingContactUpdate,
  ): AgentUpdateResult<NetworkContact> {
    const before = this.networking.get(id);
    if (!before) throw new Error(`Contact not found: ${id}`);
    const changeId = updateChangeId(context.toolCallId);
    const record = this.networking.update({
      actor: context.actor,
      source: "agent",
      summary: `Agent updated networking contact ${id} (request ${context.requestId}, tool ${context.toolCallId})`,
      changeId,
    }, id, patch);
    return {
      status: "ok",
      entity: "networking_contact",
      changeId,
      record,
      changes: changedFields(before, record, patch),
    };
  }

  revertAgentChange(
    context: AgentMutationContext,
    targetChangeId: string,
  ): AgentRevertResult {
    const changeId = revertChangeId(context.toolCallId);
    const result = this.persistence.revertAgentChange({
      actor: context.actor,
      source: "agent",
      summary: `Agent reverted ${targetChangeId} (request ${context.requestId}, tool ${context.toolCallId})`,
      changeId,
    }, targetChangeId);
    return {
      status: "ok",
      entity: "agent_change",
      changeId: result.changeId,
      revertedChangeId: targetChangeId,
      affected: result.value,
    };
  }
}
