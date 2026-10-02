/**
 * Agent canvases, as the Canvas panel and the command palette see them.
 *
 * The server owns the store; this holds the last snapshot read from it for
 * one project. The list is only loaded where a consumer is on screen (the
 * panel's own load), so nothing polls in the background.
 *
 * A failed load never blanks what is already held — an empty list would read
 * as "the agent never built a canvas", the exact wrong answer when the
 * request just did not arrive.
 */

import { create } from 'zustand';

import {
  deleteCanvas,
  listCanvases,
  type CanvasSummary,
} from '@/lib/canvasApi';

interface CanvasState {
  canvases: CanvasSummary[];
  /** The project the held entries belong to. */
  projectId: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;

  /** `maxAgeMs` skips the read when the same project's list is fresh enough. */
  load: (projectId: string | null, options?: { maxAgeMs?: number }) => Promise<void>;
  /** Re-read the list the last load used. */
  refresh: () => Promise<void>;
  deleteCanvas: (canvasId: string) => Promise<boolean>;
  reset: () => void;
}

// SAFETY: each field is a literal of the exact type CanvasState declares;
// the assertions only label the arrays and nulls for the setter.
const EMPTY_STATE = {
  canvases: [] as CanvasSummary[],
  projectId: null as string | null,
  loading: false,
  loaded: false,
  error: null as string | null,
};

/** Only the newest load may write to the store. */
let loadSequence = 0;

/**
 * Reads the message off a caught value. TypeScript gives every `catch` the
 * type `unknown` by construction, so this function is that boundary's own
 * parser: an Error with a message is the one shape that carries text, and
 * the fallback is what everything else reads as.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the parameter type is TypeScript's own `unknown` catch contract, not an unparsed domain value
const messageOf = (caught: unknown, fallback: string): string => (
  caught instanceof Error && caught.message ? caught.message : fallback
);

export const useCanvasStore = create<CanvasState>((set, get) => ({
  ...EMPTY_STATE,

  load: async (projectId, options) => {
    const previous = get();
    const ownerChanged = previous.projectId !== projectId;
    if (
      options?.maxAgeMs !== undefined
      && !ownerChanged
      && previous.loaded
      && previous.error === null
    ) {
      return;
    }
    const requestId = ++loadSequence;
    if (ownerChanged) {
      set({ loading: true, projectId, canvases: [], error: null });
    } else {
      set({ loading: true, projectId });
    }
    if (!projectId) {
      if (requestId !== loadSequence) return;
      set({ ...EMPTY_STATE, loaded: true });
      return;
    }
    try {
      const canvases = await listCanvases(projectId);
      if (requestId !== loadSequence) return;
      set({
        canvases,
        projectId,
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (error) {
      if (requestId !== loadSequence) return;
      // Whatever was loaded before stays. Only the error is new.
      set({
        loading: false,
        loaded: previous.loaded,
        error: messageOf(error, 'Failed to load canvases'),
      });
    }
  },

  refresh: async () => {
    await get().load(get().projectId);
  },

  deleteCanvas: async (canvasId) => {
    const { projectId } = get();
    if (!projectId) return false;
    try {
      const deleted = await deleteCanvas(projectId, canvasId);
      if (deleted) {
        set({ canvases: get().canvases.filter((canvas) => canvas.id !== canvasId) });
      }
      return deleted;
    } catch (error) {
      set({ error: messageOf(error, 'Failed to delete the canvas') });
      return false;
    }
  },

  reset: () => {
    set({ ...EMPTY_STATE });
  },
}));
