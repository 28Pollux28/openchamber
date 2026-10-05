import { beforeEach, describe, expect, test } from 'bun:test';
import { GUEST_SHELLS_MAX } from '@openchamber/sdk';
import type { Session } from '@/lib/opencode/model';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useBackgroundShellsStore, type TrackedShell } from '@/sync/background-shells';
import { observeGuestShells, readGuestShells } from './shells';

const session = (id: string, parentID?: string): Session => ({
  id, directory: '/repo', title: id, projectID: 'p', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  ...(parentID ? { parentID } : {}),
});
const shell = (id: string, sessionID: string, startedAt: number, background: boolean): TrackedShell => ({
  id, sessionID, command: `run ${id}`, startedAt, directory: '/repo', background, file: 'shell.log',
});

beforeEach(() => {
  useGlobalSessionsStore.getState().applySnapshot([session('root'), session('child', 'root'), session('other')], [], 'ready');
  useBackgroundShellsStore.setState({
    byId: new Map([
      ['sh_1', shell('sh_1', 'root', 2, true)],
      ['sh_2', shell('sh_2', 'child', 1, true)],
      ['sh_3', shell('sh_3', 'other', 3, true)],
      ['sh_4', shell('sh_4', 'root', 4, false)],
    ]),
    sessionIds: new Set(['root', 'child', 'other']),
  });
});

describe('extension shells projection', () => {
  test('lists the tree oldest first and keeps the background flag', () => {
    const snapshot = readGuestShells('root');
    expect(snapshot.kind).toBe('shells');
    expect(snapshot.shells.map((entry) => entry.id)).toEqual(['sh_2', 'sh_1', 'sh_4']);
    expect(snapshot.shells.find((entry) => entry.id === 'sh_4')?.background).toBe(false);
  });

  test('caps the projection at the documented shell bound', () => {
    const byId = new Map<string, TrackedShell>();
    for (let index = 0; index < GUEST_SHELLS_MAX + 50; index += 1) {
      byId.set(`sh_${index}`, shell(`sh_${index}`, 'root', index, true));
    }
    useBackgroundShellsStore.setState({ byId, sessionIds: new Set(['root']) });
    const snapshot = readGuestShells('root');
    expect(snapshot.shells).toHaveLength(GUEST_SHELLS_MAX);
  });

  test('observers replay the current snapshot and publish changes', async () => {
    const seen: string[][] = [];
    const stop = observeGuestShells('root', (snapshot) => seen.push(snapshot.shells.map((entry) => entry.id)));
    try {
      expect(seen).toEqual([['sh_2', 'sh_1', 'sh_4']]);
      useBackgroundShellsStore.setState((state) => {
        const byId = new Map(state.byId);
        byId.delete('sh_1');
        return { byId, sessionIds: new Set(['root', 'child', 'other']) };
      });
      await Promise.resolve();
      expect(seen.at(-1)).toEqual(['sh_2', 'sh_4']);
    } finally {
      stop();
    }
  });
});
