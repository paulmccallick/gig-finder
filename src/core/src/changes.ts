import type { ChangeContext, RevertedRecord } from "./models";
import type { Persistence, UnitOfWork } from "./ports";
import { MutationError, OptimisticConcurrencyError } from "./errors";

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
    write: (transaction: UnitOfWork) => T,
  ): MutationResult<T> {
    if (options.dryRun) return { record: candidate, changeId: null };
    try {
      const result = this.persistence.change(context, write);
      return { record: result.value, changeId: result.changeId };
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        throw new MutationError(
          "revision_conflict",
          error.message,
          { cause: error },
        );
      }
      throw error;
    }
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
