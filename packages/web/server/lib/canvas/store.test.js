import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCanvasRuntime, CANVAS_HTML_MAX } from './store.js';

const PROJECT_ID = 'path_dGVzdA';

let rootDir;
let runtime;
let idCounter;

const projectCanvasRoot = () => path.join(rootDir, 'projects', PROJECT_ID, 'canvas');

beforeEach(async () => {
  rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-canvas-'));
  idCounter = 0;
  runtime = createCanvasRuntime({
    fsPromises,
    path,
    projectsDirPath: path.join(rootDir, 'projects'),
    createId: () => `cv-${++idCounter}`.padEnd(8, 'x').slice(0, 8),
  });
});

afterEach(async () => {
  await fsPromises.rm(rootDir, { recursive: true, force: true });
});

describe('create', () => {
  test('writes version 1 and the meta next to it', async () => {
    const result = await runtime.create(PROJECT_ID, { title: 'Coverage', html: '<html><body>hi</body></html>' });
    expect(result).toMatchObject({ title: 'Coverage', version: 1 });
    const meta = JSON.parse(await fsPromises.readFile(path.join(projectCanvasRoot(), result.id, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ id: result.id, title: 'Coverage', latest: 1 });
    await fsPromises.access(path.join(projectCanvasRoot(), result.id, 'v1.html'));
  });

  test('the default generated id survives its own read gate', async () => {
    // cv-… must satisfy CANVAS_ID_PATTERN: a generated id the list filters
    // out or a read route refuses is the 400 that hid every canvas.
    const plainRuntime = createCanvasRuntime({
      fsPromises,
      path,
      projectsDirPath: path.join(rootDir, 'projects'),
    });
    const created = await plainRuntime.create(PROJECT_ID, { title: 'Default id', html: '<p>x</p>' });
    expect(created.id).toMatch(/^[a-z0-9][a-z0-9_-]{2,79}$/);
    const canvases = await plainRuntime.list(PROJECT_ID);
    expect(canvases.map((canvas) => canvas.id)).toContain(created.id);
    const read = await plainRuntime.read(PROJECT_ID, created.id);
    expect(read.html).toBe('<p>x</p>');
  });

  test('an underscore id written by the earlier generator stays readable', async () => {
    const underscoreRuntime = createCanvasRuntime({
      fsPromises,
      path,
      projectsDirPath: path.join(rootDir, 'projects'),
      createId: () => 'cv_underscored',
    });
    const created = await underscoreRuntime.create(PROJECT_ID, { title: 'Legacy', html: '<p>x</p>' });
    expect((await underscoreRuntime.list(PROJECT_ID)).map((canvas) => canvas.id)).toContain('cv_underscored');
    expect((await underscoreRuntime.read(PROJECT_ID, created.id)).html).toBe('<p>x</p>');
  });

  test('a canvas goes to the bounded project stem, not the raw id', async () => {
    const longId = `path_${'x'.repeat(240)}`;
    await runtime.create(longId, { title: 'T', html: '<p>x</p>' });
    const entries = await fsPromises.readdir(path.join(rootDir, 'projects'));
    expect(entries).toHaveLength(1);
    expect(entries[0].length).toBeLessThanOrEqual(200);
  });

  test('title is required, html is required', async () => {
    await expect(runtime.create(PROJECT_ID, { html: '<p>x</p>' })).rejects.toThrow('title is required');
    await expect(runtime.create(PROJECT_ID, { title: 'T', html: '   ' })).rejects.toThrow('html is required');
  });

  test('oversized html is refused with the number to fix', async () => {
    const html = 'x'.repeat(CANVAS_HTML_MAX + 1);
    await expect(runtime.create(PROJECT_ID, { title: 'T', html })).rejects.toThrow(/The canvas document is \d+ characters/);
  });
});

describe('update', () => {
  test('appends a version and moves latest forward', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'Coverage', html: '<p>1</p>' });
    const updated = await runtime.update(PROJECT_ID, created.id, { title: 'Coverage', html: '<p>2</p>' });
    expect(updated.version).toBe(2);
    const meta = JSON.parse(await fsPromises.readFile(path.join(projectCanvasRoot(), created.id, 'meta.json'), 'utf8'));
    expect(meta.latest).toBe(2);
    expect(await fsPromises.readFile(path.join(projectCanvasRoot(), created.id, 'v1.html'), 'utf8')).toBe('<p>1</p>');
    expect(await fsPromises.readFile(path.join(projectCanvasRoot(), created.id, 'v2.html'), 'utf8')).toBe('<p>2</p>');
  });

  test('a title-only patch re-titles without adding a version', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'Coverage', html: '<p>1</p>' });
    const updated = await runtime.update(PROJECT_ID, created.id, { title: 'Renamed' });
    expect(updated.version).toBe(1);
    const meta = JSON.parse(await fsPromises.readFile(path.join(projectCanvasRoot(), created.id, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ title: 'Renamed', latest: 1 });
  });

  test('unknown canvas answers null, never a write', async () => {
    expect(await runtime.update(PROJECT_ID, 'cv-nonexistent', { title: 'T', html: '<p>x</p>' })).toBeNull();
  });

  test('oversized html is refused before any write lands', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'T', html: '<p>1</p>' });
    await expect(runtime.update(PROJECT_ID, created.id, { title: 'T', html: 'x'.repeat(CANVAS_HTML_MAX + 1) })).rejects.toThrow();
    const meta = JSON.parse(await fsPromises.readFile(path.join(projectCanvasRoot(), created.id, 'meta.json'), 'utf8'));
    expect(meta.latest).toBe(1);
  });
});

describe('versions', () => {
  test('read without a version returns the latest', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'T', html: '<p>1</p>' });
    await runtime.update(PROJECT_ID, created.id, { title: 'T', html: '<p>2</p>' });
    const result = await runtime.read(PROJECT_ID, created.id);
    expect(result.version).toBe(2);
    expect(result.html).toBe('<p>2</p>');
  });

  test('a pruned version reads as absent, not as corruption', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'T', html: '<p>1</p>' });
    for (let i = 2; i <= 22; i += 1) {
      await runtime.update(PROJECT_ID, created.id, { title: 'T', html: `<p>${i}</p>` });
    }
    const pruned = await runtime.read(PROJECT_ID, created.id, 1);
    expect(pruned.meta.latest).toBe(22);
    expect(pruned.html).toBeNull();
    const oldest = await runtime.read(PROJECT_ID, created.id, 3);
    expect(oldest.html).toBe('<p>3</p>');
  });

  test('the current version is never pruned away', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'T', html: '<p>1</p>' });
    for (let i = 2; i <= 25; i += 1) {
      await runtime.update(PROJECT_ID, created.id, { title: 'T', html: `<p>${i}</p>` });
    }
    const describe_ = await runtime.describe(PROJECT_ID, created.id);
    expect(describe_.versions.at(-1).n).toBe(25);
    expect(describe_.versions).toHaveLength(20);
  });
});

describe('list', () => {
  test('returns canvases newest change first, metadata only', async () => {
    const first = await runtime.create(PROJECT_ID, { title: 'First', html: '<p>1</p>' });
    const second = await runtime.create(PROJECT_ID, { title: 'Second', html: '<p>2</p>' });
    const canvases = await runtime.list(PROJECT_ID);
    expect(canvases.map((canvas) => canvas.title)).toEqual(['Second', 'First']);
    expect(canvases[0].version).toBe(1);
    expect(canvases).not.toHaveProperty('html');
    expect(second.id).not.toBe(first.id);
  });

  test('a canvas with malformed meta is skipped, the list survives', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'Healthy', html: '<p>x</p>' });
    const brokenDir = path.join(projectCanvasRoot(), 'cv-broken');
    await fsPromises.mkdir(brokenDir, { recursive: true });
    await fsPromises.writeFile(path.join(brokenDir, 'meta.json'), 'not json', 'utf8');
    const canvases = await runtime.list(PROJECT_ID);
    expect(canvases.map((canvas) => canvas.id)).toEqual([created.id]);
  });

  test('no project directory is an empty list', async () => {
    expect(await runtime.list(PROJECT_ID)).toEqual([]);
  });
});

describe('per-project limit', () => {
  test('a full project refuses another canvas with its titles', async () => {
    for (let i = 1; i <= runtime.limits.perProjectMax; i += 1) {
      await runtime.create(PROJECT_ID, { title: `Canvas ${i}`, html: `<p>${i}</p>` });
    }
    await expect(runtime.create(PROJECT_ID, { title: 'One too many', html: '<p>x</p>' }))
      .rejects.toThrow(/already holds 100 canvases/);
    const canvases = await runtime.list(PROJECT_ID);
    expect(canvases).toHaveLength(runtime.limits.perProjectMax);
  });
});

describe('delete', () => {
  test('removes the whole canvas directory', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'T', html: '<p>1</p>' });
    expect((await runtime.remove(PROJECT_ID, created.id)).deleted).toBe(true);
    expect(await runtime.readMeta(PROJECT_ID, created.id)).toBeNull();
    expect((await runtime.remove(PROJECT_ID, created.id)).deleted).toBe(false);
  });
});

describe('concurrent writes', () => {
  test('two updates of one canvas land as two versions, both readable', async () => {
    const created = await runtime.create(PROJECT_ID, { title: 'T', html: '<p>1</p>' });
    const [a, b] = await Promise.all([
      runtime.update(PROJECT_ID, created.id, { title: 'T', html: '<p>a</p>' }),
      runtime.update(PROJECT_ID, created.id, { title: 'T', html: '<p>b</p>' }),
    ]);
    const versions = [a.version, b.version].sort((x, y) => x - y);
    expect(versions).toEqual([2, 3]);
    const meta = JSON.parse(await fsPromises.readFile(path.join(projectCanvasRoot(), created.id, 'meta.json'), 'utf8'));
    expect(meta.latest).toBe(3);
  });
});

describe('id sanitation', () => {
  test('path traversal cannot reach another project or the filesystem', async () => {
    await expect(runtime.read(PROJECT_ID, '../other')).rejects.toThrow('unsupported characters');
    await expect(runtime.list('bad id!')).rejects.toThrow('unsupported characters');
  });
});
