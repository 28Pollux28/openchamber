import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createCanvasActions } from './actions.js';

/**
 * The dispatch the `openchamber_canvas` tool reaches.
 *
 * Project scope is derived from the session directory here, never from the
 * model — the same rule memory follows — so most of these tests are about
 * what a model-side input can and cannot name.
 */

let rootDir;
let calls;
let actions;

const createActions = (overrides = {}) => {
  calls = { ...calls, ...overrides.calls };
  return createCanvasActions({
    canvasRuntime: overrides.canvasRuntime ?? {
      create: async (projectId, value) => {
        calls.createProjectId = projectId;
        calls.createValue = value;
        return { id: 'cv-1', title: value.title, version: 1, updatedAt: 1 };
      },
      update: async (projectId, canvasId, patch) => {
        calls.updateProjectId = projectId;
        calls.updateCanvasId = canvasId;
        calls.updatePatch = patch;
        return canvasId === 'cv-1' ? { id: 'cv-1', title: patch.title, version: 2, updatedAt: 2 } : null;
      },
      list: async (projectId) => {
        calls.listProjectId = projectId;
        return [{ id: 'cv-1', title: 'Coverage', version: 2, createdAt: 1, updatedAt: 2 }];
      },
      read: async (projectId, canvasId, version) => {
        calls.readProjectId = projectId;
        calls.readCanvasId = canvasId;
        calls.readVersion = version;
        if (canvasId !== 'cv-1') return null;
        return version === 1
          ? { meta: { id: 'cv-1', title: 'Coverage', latest: 2 }, html: null, version: 1 }
          : { meta: { id: 'cv-1', title: 'Coverage', latest: 2 }, html: '<p>x</p>', version: 2 };
      },
    },
    createError: (message, status) => {
      const error = new Error(message);
      error.statusCode = status;
      return error;
    },
    onCanvasChanged: (event) => {
      calls.announced = event;
    },
    resolveProjectId: async (directory) => (calls.resolveFrom = directory) ? 'path_dGVzdA' : '',
    ...overrides,
  });
};

beforeEach(() => {
  calls = {};
  actions = createActions();
});

afterEach(() => {
  calls = undefined;
});

describe('canvas.update', () => {
  test('creates when no id is given, deriving the project from the directory', async () => {
    const result = await actions.execute('canvas.update', { title: 'Coverage', html: '<p>x</p>' }, '/repo');
    expect(calls.createProjectId).toBe('path_dGVzdA');
    expect(result).toMatchObject({ id: 'cv-1', title: 'Coverage', version: 1, created: true });
    expect(calls.announced).toEqual({ projectId: 'path_dGVzdA', canvasId: 'cv-1' });
  });

  test('updates when an id is given', async () => {
    const result = await actions.execute('canvas.update', { canvasId: 'cv-1', title: 'Coverage', html: '<p>y</p>' }, '/repo');
    expect(calls.updateCanvasId).toBe('cv-1');
    expect(result.created).toBe(false);
    expect(result.version).toBe(2);
  });

  test('an unknown id is a 404, never a second canvas', async () => {
    await expect(actions.execute('canvas.update', { canvasId: 'cv-ghost', title: 'T', html: '<p>x</p>' }, '/repo'))
      .rejects.toThrow('No canvas has that id in this project');
    expect(calls.updateProjectId).toBe('path_dGVzdA');
  });

  test('title and html are required', async () => {
    await expect(actions.execute('canvas.update', { title: '  ' }, '/repo')).rejects.toThrow('title is required');
    await expect(actions.execute('canvas.update', { title: 'T', html: 42 }, '/repo')).rejects.toThrow('html must be a string');
  });

  test('no session directory is an error, never a write to a guessed project', async () => {
    await expect(actions.execute('canvas.update', { title: 'T', html: '<p>x</p>' }, ''))
      .rejects.toThrow('Canvas needs a session directory');
  });

  test('a failed announce never fails the write', async () => {
    actions = createActions({ onCanvasChanged: () => { throw new Error('listener broke'); } });
    const result = await actions.execute('canvas.update', { title: 'T', html: '<p>x</p>' }, '/repo');
    expect(result.created).toBe(true);
  });
});

describe('canvas.list', () => {
  test('lists the derived project', async () => {
    const result = await actions.execute('canvas.list', {}, '/repo');
    expect(calls.listProjectId).toBe('path_dGVzdA');
    expect(result.canvases).toEqual([{ canvasId: 'cv-1', title: 'Coverage', version: 2, updatedAt: 2 }]);
  });

  test('the model cannot name a project', async () => {
    // No projectId input exists; a directory-less call is the only way it
    // could be mis-scoped, and that one is refused above.
    await expect(actions.execute('canvas.list', { projectId: 'path_other' }, '')).rejects.toThrow();
  });
});

describe('canvas.read', () => {
  test('reads the latest by default', async () => {
    const result = await actions.execute('canvas.read', { canvasId: 'cv-1' }, '/repo');
    expect(calls.readVersion).toBeUndefined();
    expect(result).toMatchObject({ id: 'cv-1', version: 2, html: '<p>x</p>' });
  });

  test('reads an explicit version; a pruned one says so', async () => {
    const ok = await actions.execute('canvas.read', { canvasId: 'cv-1', version: 2 }, '/repo');
    expect(calls.readVersion).toBe(2);
    expect(ok.html).toBe('<p>x</p>');
    await expect(actions.execute('canvas.read', { canvasId: 'cv-1', version: 1 }, '/repo'))
      .rejects.toThrow(/Version 1 .* is no longer stored/);
  });

  test('unknown canvas is a 404', async () => {
    await expect(actions.execute('canvas.read', { canvasId: 'cv-ghost' }, '/repo')).rejects.toThrow('No canvas has that id');
  });
});
