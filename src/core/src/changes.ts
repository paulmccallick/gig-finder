import type { ChangeContext, RevertedRecord } from "./models";
import type { Persistence, UnitOfWork } from "./ports";

export interface MutationOptions {
  dryRun?: boolean;
}

export interface MutationResult<T> {
  record: T;
  changeId: string | null;
}

export interface ChangeRevertResult {
  changeId: string;
  revertedChangeId: string;
  affected: RevertedRecord[];
}

export class ChangeExecutor {
  constructor(private readonly persistence: Persistence) {}

  execute<T>(
    context: ChangeContext,
    candidate: T,
    options: MutationOptions,
    write: (transaction: UnitOfWork) => void,
  ): MutationResult<T> {
    if (options.dryRun) return { record: candidate, changeId: null };
    const result = this.persistence.change(context, transaction => {
      write(transaction);
      return candidate;
    });
    return { record: result.value, changeId: result.changeId };
  }
}

export class ChangeService {
  constructor(private readonly persistence: Persistence) {}

  revert(
    context: ChangeContext,
    targetChangeId: string,
  ): ChangeRevertResult {
    const result = this.persistence.revertChange(context, targetChangeId);
    return {
      changeId: result.changeId,
      revertedChangeId: targetChangeId,
      affected: result.value,
    };
  }
}
