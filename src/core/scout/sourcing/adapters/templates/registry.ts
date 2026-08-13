import type { ReusableJsonRequestHook } from "./types";
import { AdpSessionRequestHook } from "./adp-session-request-hook";
import { AvatureSessionRequestHook } from "./avature-session-request-hook";
const requestHooks: Record<string, ReusableJsonRequestHook> = {
  "adp-session": new AdpSessionRequestHook(),
  "avature-session": new AvatureSessionRequestHook(),
};
export const reusableJsonRequestHook = (capability: string | undefined) =>
  capability ? requestHooks[capability] : undefined;

export const reusableJsonRequestHookExists = (capability: string) =>
  Boolean(requestHooks[capability]);
