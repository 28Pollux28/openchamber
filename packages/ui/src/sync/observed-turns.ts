import type { StoreApi } from "zustand"
import type { SessionStatus } from "@/lib/opencode/model"
import type { DirectoryStore } from "./child-store"

/**
 * Turns this page watched run on the OpenCode server it is connected to.
 *
 * OpenCode keeps run state per process. A turn started by another OpenCode
 * process on the same database (the TUI, `opencode run`) never reaches this
 * server's event stream or its active-session snapshot, so a snapshot or a
 * message load sees it as an idle session with an unfinished answer, which is
 * exactly what a turn that died mid-way looks like (#4156). Only a run this
 * page saw busy or retrying may be judged interrupted from a snapshot or a
 * message load. A `session.idle`/`session.error` event needs no record: it
 * comes from the process that ran the turn.
 *
 * A record lasts until its run ends: a settle event from the server, or a
 * snapshot judged against loaded messages. A later turn from another process
 * in the same session must not inherit it. Records belong to one directory
 * store and disappear with it on a runtime switch.
 */
const observedTurns = new WeakMap<StoreApi<DirectoryStore>, Set<string>>()

export function recordObservedTurn(
  store: StoreApi<DirectoryStore>,
  sessionID: string,
  status: SessionStatus | undefined,
): void {
  if (!status || status.type === "idle") return
  let sessions = observedTurns.get(store)
  if (!sessions) {
    sessions = new Set()
    observedTurns.set(store, sessions)
  }
  sessions.add(sessionID)
}

export function hasObservedTurn(store: StoreApi<DirectoryStore>, sessionID: string): boolean {
  return observedTurns.get(store)?.has(sessionID) === true
}

/** A settle event ends the run on the server that ran it. */
export function forgetObservedTurn(store: StoreApi<DirectoryStore>, sessionID: string): void {
  observedTurns.get(store)?.delete(sessionID)
}

/** Forgets the run once a snapshot settled the session and its messages were judged. */
export function releaseJudgedTurn(
  store: StoreApi<DirectoryStore>,
  state: Pick<DirectoryStore, "session_status" | "message">,
  sessionID: string,
): void {
  if (state.session_status?.[sessionID]?.type !== "idle") return
  if (!state.message[sessionID]) return
  observedTurns.get(store)?.delete(sessionID)
}
