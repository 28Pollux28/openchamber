export const GUEST_SHELL_ID_MAX = 128;
export const GUEST_SHELLS_MAX = 200;
export const GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

/** A shell command still running on behalf of a session. */
export type GuestRunningShell = {
  id: string;
  sessionID: string;
  command: string;
  startedAt: number;
  /** True for a job the turn does not wait for; false while the turn that ran it is blocked on it. */
  background: boolean;
};

export type GuestRunningShellsSnapshot = {
  kind: 'shells';
  /** The session the subscription was opened for; the shells include its subagents. */
  sessionId: string;
  shells: GuestRunningShell[];
};

export type GuestShellsSubscription = { subscriptionId: string; sessionId: string };
export type GuestShellOutputRequest = { shellId: string; cursor?: number; tailBytes?: number };
export type GuestShellOutputResult = { output: string; cursor: number; skipped: boolean };
export type GuestShellStopResult = { stopped: true };
