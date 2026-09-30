import { afterEach, describe, expect, test } from "bun:test"
import type { MessagePage } from "@/lib/opencode/client"
import type { SyncEvent } from "@/lib/opencode/events"
import type { Message, Part } from "@/lib/opencode/model"
import { getRuntimeKey } from "@/lib/runtime-switch"
import { ChildStoreManager } from "./child-store"
import { SessionMessageLoader, setImperativeSessionMessageLoader } from "./session-message-loader"
import { createEventRoutingIndex, handleEvent, recoverInterruptedTurnAfterMessageLoad } from "./sync-context"

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

const user: Message = { id: "msg_u", sessionID: "ses_1", role: "user", time: { created: 1 } }
const openAssistant: Message = {
  id: "msg_a", sessionID: "ses_1", role: "assistant", time: { created: 2 },
  modelID: "m", providerID: "p", agent: "build",
}
const text: Part = { id: "prt_a", messageID: "msg_a", sessionID: "ses_1", type: "text", text: "4" }

function setup(serverRecords: () => Array<{ info: Message; parts: Part[] }>) {
  const childStores = new ChildStoreManager()
  const store = childStores.ensureChild("/repo", { bootstrap: false })
  const routingIndex = createEventRoutingIndex()
  // The live stream of the server this page is connected to.
  const receive = (event: SyncEvent) => handleEvent("/repo", event, childStores, routingIndex, getRuntimeKey())
  store.setState({
    session: [],
    message: { ses_1: [user, openAssistant] },
    part: { msg_a: [text] },
    session_status: { ses_1: { type: "idle" } },
  })
  let reads = 0
  const sdk = {
    getSessionMessages: async (): Promise<MessagePage> => {
      reads += 1
      return { items: serverRecords(), cursor: {} }
    },
  }
  const loader = new SessionMessageLoader(childStores, { sdk, runtimeKey: "recovery-test" })
  setImperativeSessionMessageLoader(loader)
  cleanups.push(() => { setImperativeSessionMessageLoader(null); childStores.disposeAll() })
  return { store, receive, reads: () => reads }
}

const busy: SyncEvent = { type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } }

describe("recoverInterruptedTurnAfterMessageLoad", () => {
  test("re-reads the tail under an idle status before calling the turn interrupted", async () => {
    // The messages were read while the turn was still running; the status was
    // read after it finished. The server now has the completed message.
    const completed: Message = { ...openAssistant, time: { created: 2, completed: 3 }, finish: "stop" }
    const { store, receive, reads } = setup(() => [{ info: user, parts: [] }, { info: completed, parts: [text] }])
    receive(busy)
    store.setState({ session_status: { ses_1: { type: "idle" } } })

    await recoverInterruptedTurnAfterMessageLoad("/repo", store, "ses_1")

    expect(reads()).toBe(1)
    const assistant = store.getState().message.ses_1.find((message) => message.id === "msg_a")
    expect(assistant).toMatchObject({ time: { completed: 3 }, finish: "stop" })
    expect(assistant !== undefined && "error" in assistant).toBe(false)
  })

  test("marks the turn interrupted when the settled server still has it open", async () => {
    const { store, receive, reads } = setup(() => [{ info: user, parts: [] }, { info: openAssistant, parts: [text] }])
    receive(busy)
    store.setState({ session_status: { ses_1: { type: "idle" } } })

    await recoverInterruptedTurnAfterMessageLoad("/repo", store, "ses_1")

    expect(reads()).toBe(1)
    const assistant = store.getState().message.ses_1.find((message) => message.id === "msg_a")
    expect(assistant).toMatchObject({ error: { type: "aborted" } })
    expect(assistant?.role === "assistant" && assistant.time.completed !== undefined).toBe(true)
  })

  test("leaves open a turn this page never saw running (#4156)", async () => {
    // Another OpenCode process on the same database (the TUI) is running the
    // turn. The connected server reports the session idle because it knows
    // nothing about that process.
    const { store, reads } = setup(() => [{ info: user, parts: [] }, { info: openAssistant, parts: [text] }])

    await recoverInterruptedTurnAfterMessageLoad("/repo", store, "ses_1")

    expect(reads()).toBe(0)
    const assistant = store.getState().message.ses_1.find((message) => message.id === "msg_a")
    expect(assistant).toBe(openAssistant)
  })

  test("a watched run that finished does not vouch for a later turn from another process", async () => {
    const completed: Message = { ...openAssistant, time: { created: 2, completed: 3 }, finish: "stop" }
    const { store, receive, reads } = setup(() => [])
    store.setState({ message: { ses_1: [user, completed] } })
    receive(busy)
    receive({ type: "session.idle", properties: { sessionID: "ses_1" } })

    // Later the TUI starts a turn in the same session; a reload brings it in.
    const tuiUser: Message = { ...user, id: "msg_u2", time: { created: 4 } }
    const tuiAssistant: Message = { ...openAssistant, id: "msg_a2", time: { created: 5 } }
    store.setState({ message: { ses_1: [user, completed, tuiUser, tuiAssistant] } })

    await recoverInterruptedTurnAfterMessageLoad("/repo", store, "ses_1")

    expect(reads()).toBe(0)
    expect(store.getState().message.ses_1.at(-1)).toBe(tuiAssistant)
  })

  test("a run settled while this page had none of its messages does not vouch for a later turn", async () => {
    // Another client ran and finished a turn here; this page never opened it.
    const { store, receive, reads } = setup(() => [])
    store.setState({ message: {}, part: {} })
    receive(busy)
    receive({ type: "session.idle", properties: { sessionID: "ses_1" } })

    // Later a TUI turn is running in it, and the user opens the session.
    store.setState({ message: { ses_1: [user, openAssistant] }, part: { msg_a: [text] } })
    await recoverInterruptedTurnAfterMessageLoad("/repo", store, "ses_1")

    expect(reads()).toBe(0)
    expect(store.getState().message.ses_1.at(-1)).toBe(openAssistant)
  })
})
