/**
 * When a browser tab waits for a local dev server instead of showing an error.
 *
 * A page opened the moment its dev server launched usually fails first:
 * nothing is listening yet. Those loads are retried for a while, because the
 * user or the agent that opened the page just started the server and expects
 * it to come up.
 *
 * A tab restored from saved state is different. Nobody asked for that load: it
 * happens at app launch, or when a project's panel is shown again, and its
 * server is usually just not running. Retrying it would hammer a closed port
 * for the whole wait, often in a panel nobody is looking at. So a restored
 * load runs once and fails honestly; the wait comes back with the next load
 * the user, the agent or the page starts.
 */
import { isStartingServerFailure } from './url';

/** How long to keep waiting for a dev server that is still coming up. */
export const DEV_SERVER_WAIT_MS = 40_000;

/**
 * Tabs just opened with an address, whose first load was asked for now rather
 * than restored. Session-only and forgotten once the tab has mounted, so a
 * later remount of the same tab counts as restored.
 */
const tabsOpenedWithAddress = new Set<string>();

export const noteBrowserTabOpenedWithAddress = (tabID: string): void => {
  tabsOpenedWithAddress.add(tabID);
};

/** False for a tab restored from saved state. Pure, so it is safe to read while rendering. */
export const wasBrowserTabOpenedWithAddress = (tabID: string): boolean => (
  tabsOpenedWithAddress.has(tabID)
);

/** Called once the tab has mounted: any later mount is a restore. */
export const forgetBrowserTabOpenedWithAddress = (tabID: string): void => {
  tabsOpenedWithAddress.delete(tabID);
};

export type DevServerWaitRun = { readonly url: string; readonly startedAt: number };

type FailedLoad = { readonly code: number; readonly url: string };

type FailedLoadPlan = {
  readonly retry: boolean;
  /** The run to keep for the next failure. */
  readonly run: DevServerWaitRun | null;
};

/**
 * Decides whether a failed load is retried.
 *
 * `restored` marks the load a tab made from saved state: it is never retried.
 * Otherwise a loopback address that is not answering yet is retried until the
 * run that began with its first failure has lasted {@link DEV_SERVER_WAIT_MS}.
 */
export const planFailedLoadRetry = (
  failure: FailedLoad,
  { run, restored, now }: { run: DevServerWaitRun | null; restored: boolean; now: number },
): FailedLoadPlan => {
  if (restored || !isStartingServerFailure(failure.code, failure.url)) {
    return { retry: false, run };
  }
  const current = run?.url === failure.url ? run : { url: failure.url, startedAt: now };
  return { retry: now - current.startedAt <= DEV_SERVER_WAIT_MS, run: current };
};
