import type { GuestRunningShell, GuestRunningShellsSnapshot } from '@openchamber/sdk';
import { sessionsInTree, useBackgroundShellsStore } from '@/sync/background-shells';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

/** The running shells of a session and its subagents, oldest first. Local store only; never a network read. */
export const readGuestShells = (sessionId: string): GuestRunningShellsSnapshot => {
  const store = useBackgroundShellsStore.getState();
  const sessions = useGlobalSessionsStore.getState().entityById;
  const known = new Set<string>();
  for (const shell of store.byId.values()) known.add(shell.sessionID);
  const inTree = new Set(sessionsInTree(known, sessionId, (id) => sessions.get(id)?.parentID ?? undefined));
  const shells: GuestRunningShell[] = [];
  for (const shell of store.byId.values()) {
    if (!inTree.has(shell.sessionID)) continue;
    shells.push({ id: shell.id, sessionID: shell.sessionID, command: shell.command, startedAt: shell.startedAt, background: shell.background });
  }
  shells.sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
  return { kind: 'shells', sessionId, shells };
};

type Observer = { listeners: Set<(snapshot: GuestRunningShellsSnapshot) => void>; snapshot: GuestRunningShellsSnapshot; dispose: () => void };
const observers = new Map<string, Observer>();

/** One shared observer per runtime and session, mirroring the workspace observer lifecycle. */
export const observeGuestShells = (sessionId: string, listener: (snapshot: GuestRunningShellsSnapshot) => void): (() => void) => {
  const key = JSON.stringify([getRuntimeKey(), sessionId]);
  let observer = observers.get(key);
  if (!observer) {
    const listeners = new Set<(snapshot: GuestRunningShellsSnapshot) => void>();
    const current: Observer = { listeners, snapshot: readGuestShells(sessionId), dispose: () => {} };
    let queued = false;
    let disposed = false;
    let serialized = JSON.stringify(current.snapshot);
    const update = () => {
      if (queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        const next = readGuestShells(sessionId);
        const json = JSON.stringify(next);
        if (json === serialized) return;
        serialized = json;
        current.snapshot = next;
        for (const notify of listeners) notify(next);
      });
    };
    const unsubs = [
      useBackgroundShellsStore.subscribe(update),
      useGlobalSessionsStore.subscribe((state, previous) => { if (state.entityById !== previous.entityById) update(); }),
    ];
    current.dispose = () => { disposed = true; for (const unsubscribe of unsubs) unsubscribe(); observers.delete(key); };
    unsubs.push(subscribeRuntimeEndpointChanged(current.dispose));
    observers.set(key, current);
    observer = current;
  }
  observer.listeners.add(listener);
  listener(observer.snapshot);
  const current = observer;
  return () => { current.listeners.delete(listener); if (current.listeners.size === 0) current.dispose(); };
};
