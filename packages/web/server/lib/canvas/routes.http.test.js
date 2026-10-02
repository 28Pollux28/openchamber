import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerCanvasRoutes } from './routes.js';

/**
 * End-to-end route tests over real HTTP, mounted on a bare express app.
 *
 * All four routes are reads and deletes, so none carries a body parser: a
 * canvas is written through the agent tool, and a route that parsed a body
 * it never reads would be the one eating the OpenCode proxy's stream.
 */

const meta = (overrides = {}) => ({
  id: 'cv-1',
  title: 'Coverage',
  createdAt: 1,
  updatedAt: 2,
  version: 2,
  ...overrides,
});

const createApp = (overrides = {}) => {
  const received = {};
  const runtime = {
    list: async (projectId) => {
      received.listProjectId = projectId;
      return [meta()];
    },
    describe: async (projectId, canvasId) => {
      received.describeProjectId = projectId;
      received.describeCanvasId = canvasId;
      return canvasId === 'cv-1'
        ? { ...meta(), versions: [{ n: 1, size: 5, createdAt: 1 }, { n: 2, size: 6, createdAt: 2 }] }
        : null;
    },
    read: async (projectId, canvasId, version) => {
      received.readProjectId = projectId;
      received.readCanvasId = canvasId;
      received.readVersion = version;
      if (canvasId !== 'cv-1') return null;
      if (version === 9) return { meta: meta(), html: null, version: 9 };
      return { meta: meta(), html: '<p>hi</p>', version: version ?? 2 };
    },
    remove: async (projectId, canvasId) => {
      received.removeProjectId = projectId;
      received.removeCanvasId = canvasId;
      return { deleted: canvasId === 'cv-1' };
    },
    ...overrides.runtime,
  };

  const app = express();
  registerCanvasRoutes(app, { canvasRuntime: runtime });
  return { app, received };
};

describe('GET /api/canvas', () => {
  it('lists one project', async () => {
    const { app, received } = createApp();
    const response = await request(app).get('/api/canvas?projectId=path_dGVzdA');
    expect(response.status).toBe(200);
    expect(received.listProjectId).toBe('path_dGVzdA');
    expect(response.body).toEqual({ canvases: [meta()] });
  });

  it('projectId is required and shape-checked', async () => {
    const { app } = createApp();
    expect((await request(app).get('/api/canvas')).status).toBe(400);
    expect((await request(app).get('/api/canvas?projectId=' + encodeURIComponent('bad id!'))).status).toBe(400);
  });
});

describe('GET /api/canvas/:id', () => {
  it('answers with metadata and versions', async () => {
    const { app, received } = createApp();
    const response = await request(app).get('/api/canvas/cv-1?projectId=path_dGVzdA');
    expect(response.status).toBe(200);
    expect(received.describeCanvasId).toBe('cv-1');
    expect(response.body.canvas.versions).toHaveLength(2);
    expect(response.body.canvas).not.toHaveProperty('html');
  });

  it('an unknown canvas is 404', async () => {
    const { app } = createApp();
    expect((await request(app).get('/api/canvas/cv-ghost?projectId=path_dGVzdA')).status).toBe(404);
  });

  it('a malformed canvasId is 400', async () => {
    const { app } = createApp();
    expect((await request(app).get('/api/canvas/' + encodeURIComponent('../etc') + '?projectId=path_dGVzdA')).status).toBe(400);
  });
});

describe('GET /api/canvas/:id/content', () => {
  it('serves JSON, not text/html', async () => {
    const { app } = createApp();
    const response = await request(app).get('/api/canvas/cv-1/content?projectId=path_dGVzdA');
    expect(response.status).toBe(200);
    expect(response.type).toMatch(/json/);
    expect(response.body.canvas.html).toBe('<p>hi</p>');
  });

  it('version rides the query; a pruned one is 404', async () => {
    const { app, received } = createApp();
    await request(app).get('/api/canvas/cv-1/content?projectId=path_dGVzdA&version=1');
    expect(received.readVersion).toBe(1);
    expect((await request(app).get('/api/canvas/cv-1/content?projectId=path_dGVzdA&version=9')).status).toBe(404);
  });

  it('a non-integer version is 400', async () => {
    const { app } = createApp();
    expect((await request(app).get('/api/canvas/cv-1/content?projectId=path_dGVzdA&version=zero')).status).toBe(400);
  });
});

describe('DELETE /api/canvas/:id', () => {
  it('deletes and reports not-found distinctly', async () => {
    const { app, received } = createApp();
    expect((await request(app).delete('/api/canvas/cv-1?projectId=path_dGVzdA')).status).toBe(200);
    expect(received.removeCanvasId).toBe('cv-1');
    expect((await request(app).delete('/api/canvas/cv-ghost?projectId=path_dGVzdA')).status).toBe(404);
  });
});
