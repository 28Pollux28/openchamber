/**
 * Agent canvas storage.
 *
 * A canvas is a standalone HTML document the agent composed for the user to
 * look at: a dashboard, a comparison, an audit. It belongs to the project the
 * session runs in, not to the repository — the checkout has to stay clean, and
 * a canvas must survive a branch switch — so it lives beside the project's
 * other server-owned data under `<projectsDir>/<stem>/canvas/`.
 *
 * One canvas is one directory: `meta.json` plus `v<n>.html` files. Every
 * `canvas.update` writes a new version rather than merging, so a canvas is
 * always a document the agent authored in one piece, and the user can step
 * back through what it showed. Only the newest versions are kept; the current
 * one is never pruned.
 *
 * The directory is the same bounded stem `projectConfigFileStemOf` gives every
 * other project-owned store (config, context, memory), so a session in any
 * worktree of a repository reaches the project's canvases.
 */

import { projectConfigFileStemOf } from '../projects/project-id.js';

const CANVAS_STORE_VERSION = 1;

/** Long enough for a real report, short enough to keep a canvas snappy. */
export const CANVAS_HTML_MAX = 2_000_000;
const CANVAS_TITLE_MAX = 120;
const CANVAS_VERSIONS_MAX = 20;
const CANVAS_PER_PROJECT_MAX = 100;

// Ids are generated here (`cv-<uuid>`), never chosen by the agent, but a
// file name is still a file name: anything that does not fit this pattern is
// refused before it reaches `path.join`. The underscore form the generator
// briefly emitted stays readable.
const CANVAS_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const VERSION_FILE_PATTERN = /^v(\d+)\.html$/;

const asNonEmptyString = (value) => {
  if (!isText(value)) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clampLength = (value, maxLength) => {
  if (!isText(value)) return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
};

const isObjectRecord = (value) => isText(value) === false
  && value !== null
  && value !== undefined
  && Object.prototype.toString.call(value) === '[object Object]'
  && !Array.isArray(value);

/** True for actual strings; JSON bodies can carry numbers and objects. */
const isText = (value) => Object.prototype.toString.call(value) === '[object String]';

const createDefaultId = () => {
  // Ids come from this process; a platform without crypto.randomUUID falls
  // back to the timestamp-and-random shape the memory ids use. Dashes, not
  // underscores: the id has to satisfy CANVAS_ID_PATTERN, and it took one
  // generated id failing that pattern for every later read to answer 400.
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `cv-${uuid}` : `cv-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

export const createCanvasRuntime = (deps) => {
  const { fsPromises, path, projectsDirPath, createId = createDefaultId } = deps;

  const writeLocks = new Map();

  const withWriteLock = async (key, mutate) => {
    const previous = writeLocks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const chained = previous.finally(() => next);
    writeLocks.set(key, chained);

    await previous;
    try {
      return await mutate();
    } finally {
      release();
      if (writeLocks.get(key) === chained) {
        writeLocks.delete(key);
      }
    }
  };

  const sanitizeProjectId = (projectId) => {
    const value = asNonEmptyString(projectId);
    if (!value) throw new Error('projectId is required');
    if (!PROJECT_ID_PATTERN.test(value)) throw new Error('projectId contains unsupported characters');
    return value;
  };

  const sanitizeCanvasId = (canvasId) => {
    const value = asNonEmptyString(canvasId);
    if (!value) throw new Error('canvasId is required');
    if (!CANVAS_ID_PATTERN.test(value)) throw new Error('canvasId contains unsupported characters');
    return value;
  };

  const canvasRoot = (projectId) => path.join(
    projectsDirPath,
    projectConfigFileStemOf(sanitizeProjectId(projectId)),
    'canvas',
  );

  const canvasDir = (projectId, canvasId) => path.join(canvasRoot(projectId), sanitizeCanvasId(canvasId));

  const metaPath = (dir) => path.join(dir, 'meta.json');

  /**
   * Missing is authoritative absence; malformed is a failure. A canvas whose
   * meta cannot be read must not be reported as empty or overwritten — the
   * versions on disk may be intact and only the index broken.
   */
  const readMetaAt = async (dir) => {
    let raw;
    try {
      raw = await fsPromises.readFile(metaPath(dir), 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Stored canvas metadata is malformed');
    }
    if (!isObjectRecord(parsed)) throw new Error('Stored canvas metadata is malformed');
    const id = asNonEmptyString(parsed.id);
    const title = clampLength(asNonEmptyString(parsed.title) || '', CANVAS_TITLE_MAX);
    const latest = Number(parsed.latest);
    if (!id || !title || !Number.isSafeInteger(latest) || latest < 1) {
      throw new Error('Stored canvas metadata is malformed');
    }
    return {
      version: CANVAS_STORE_VERSION,
      id,
      title,
      createdAt: Number.isFinite(parsed.createdAt) && parsed.createdAt >= 0 ? parsed.createdAt : 0,
      updatedAt: Number.isFinite(parsed.updatedAt) && parsed.updatedAt >= 0 ? parsed.updatedAt : 0,
      latest,
    };
  };

  const writeJsonAtomic = async (filePath, value) => {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fsPromises.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
      await fsPromises.rename(temporaryPath, filePath);
    } catch (error) {
      await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  };

  const writeHtmlAtomic = async (filePath, html) => {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fsPromises.writeFile(temporaryPath, html, 'utf8');
      await fsPromises.rename(temporaryPath, filePath);
    } catch (error) {
      await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  };

  /** Version files sorted oldest-first; `n` is the version number. */
  const readVersionIndex = async (dir) => {
    let names;
    try {
      names = await fsPromises.readdir(dir);
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    const versions = [];
    for (const name of names) {
      const match = VERSION_FILE_PATTERN.exec(name);
      if (!match) continue;
      const filePath = path.join(dir, name);
      let stats;
      try {
        stats = await fsPromises.stat(filePath);
      } catch {
        continue;
      }
      versions.push({ n: Number(match[1]), size: stats.size, createdAt: stats.mtimeMs });
    }
    return versions.sort((a, b) => a.n - b.n);
  };

  /** Keeps the newest versions only; the current one is never a candidate. */
  const pruneVersions = async (dir, latest) => {
    const versions = await readVersionIndex(dir);
    const excess = versions.length - CANVAS_VERSIONS_MAX;
    if (excess <= 0) return;
    const removable = versions.filter((entry) => entry.n !== latest).slice(0, excess);
    for (const entry of removable) {
      await fsPromises.rm(path.join(dir, `v${entry.n}.html`), { force: true }).catch(() => {});
    }
  };

  /**
   * Every canvas in the project, newest change first. A canvas whose meta is
   * unreadable is skipped rather than failing the list: one broken directory
   * must not hide the canvases the user can still open.
   */
  const list = async (projectId) => {
    const root = canvasRoot(projectId);
    let ids;
    try {
      ids = await fsPromises.readdir(root);
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    const canvases = [];
    for (const id of ids) {
      if (!CANVAS_ID_PATTERN.test(id)) continue;
      try {
        const meta = await readMetaAt(path.join(root, id));
        if (meta) canvases.push(meta);
      } catch {
        // Malformed meta: listed in neither the panel nor the agent's list.
      }
    }
    return canvases
      .map((meta) => ({
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        version: meta.latest,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const readMeta = async (projectId, canvasId) => readMetaAt(canvasDir(projectId, canvasId));

  /**
   * The metadata with its version history, for the panel's version picker.
   */
  const describe = async (projectId, canvasId) => {
    const dir = canvasDir(projectId, canvasId);
    const meta = await readMetaAt(dir);
    if (!meta) return null;
    const versions = await readVersionIndex(dir);
    return {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      version: meta.latest,
      versions,
    };
  };

  /**
   * One version's document, or null when the canvas or that version is not
   * there. A pruned version is absence, not corruption.
   */
  const read = async (projectId, canvasId, version) => {
    const dir = canvasDir(projectId, canvasId);
    const meta = await readMetaAt(dir);
    if (!meta) return null;
    const requested = version === undefined || version === null ? meta.latest : Number(version);
    if (!Number.isSafeInteger(requested) || requested < 1) {
      throw new Error('version must be a positive integer');
    }
    let html;
    try {
      html = await fsPromises.readFile(path.join(dir, `v${requested}.html`), 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { meta, html: null, version: requested };
      throw error;
    }
    return { meta, html, version: requested };
  };

  const validateHtml = (html) => {
    if (!isText(html) || html.trim().length === 0) {
      throw new Error('html is required');
    }
    if (html.length > CANVAS_HTML_MAX) {
      throw new Error(
        `The canvas document is ${html.length} characters; the limit is ${CANVAS_HTML_MAX}. `
        + 'Move the data out of the document (keep only what the view needs), or split the work.',
      );
    }
  };

  const create = async (projectId, value) => {
    const root = canvasRoot(projectId);
    const title = clampLength(asNonEmptyString(value?.title) || '', CANVAS_TITLE_MAX);
    if (!title) throw new Error('title is required');
    validateHtml(value?.html);

    return withWriteLock(`project:${root}`, async () => {
      const existing = await list(projectId);
      if (existing.length >= CANVAS_PER_PROJECT_MAX) {
        const titles = existing.slice(0, 20).map((canvas) => `- ${canvas.title}`).join('\n');
        throw new Error(
          `This project already holds ${existing.length} canvases (the limit is ${CANVAS_PER_PROJECT_MAX}). `
          + 'Update an existing one instead — pass its canvasId to canvas.update — or delete canvases you no longer need. '
          + `Canvases now stored:\n${titles}`,
        );
      }

      const now = Date.now();
      const id = createId();
      const dir = path.join(root, id);
      const meta = {
        version: CANVAS_STORE_VERSION,
        id,
        title,
        createdAt: now,
        updatedAt: now,
        latest: 1,
      };
      await writeHtmlAtomic(path.join(dir, 'v1.html'), value.html);
      await writeJsonAtomic(metaPath(dir), meta);
      return { id, title, version: 1, createdAt: now, updatedAt: now };
    });
  };

  /**
   * A full-document replace: the next version. The meta write lands after the
   * document, so a crash between the two leaves a version file meta does not
   * point at — readable again on the next update, invisible to readers.
   */
  const update = async (projectId, canvasId, patch) => {
    const dir = canvasDir(projectId, canvasId);
    const hasHtml = isText(patch?.html);
    if (patch?.html !== undefined && !hasHtml) throw new Error('html must be a string');
    const title = patch?.title !== undefined
      ? clampLength(asNonEmptyString(patch.title) || '', CANVAS_TITLE_MAX)
      : null;
    if (patch?.title !== undefined && !title) throw new Error('title is required');
    if (!hasHtml && !title) throw new Error('html or title is required');
    if (hasHtml) validateHtml(patch.html);

    return withWriteLock(`canvas:${dir}`, async () => {
      const meta = await readMetaAt(dir);
      if (!meta) return null;

      const now = Date.now();
      const next = hasHtml ? meta.latest + 1 : meta.latest;
      if (hasHtml) {
        await writeHtmlAtomic(path.join(dir, `v${next}.html`), patch.html);
      }
      const updated = {
        ...meta,
        title: title ?? meta.title,
        updatedAt: now,
        latest: next,
      };
      await writeJsonAtomic(metaPath(dir), updated);
      if (hasHtml) {
        await pruneVersions(dir, next);
      }
      return { id: updated.id, title: updated.title, version: next, updatedAt: now };
    });
  };

  const remove = async (projectId, canvasId) => {
    const dir = canvasDir(projectId, canvasId);
    return withWriteLock(`canvas:${dir}`, async () => {
      const meta = await readMetaAt(dir);
      if (!meta) return { deleted: false };
      await fsPromises.rm(dir, { recursive: true, force: true });
      return { deleted: true };
    });
  };

  return {
    list,
    readMeta,
    describe,
    read,
    create,
    update,
    remove,
    limits: {
      htmlMax: CANVAS_HTML_MAX,
      titleMax: CANVAS_TITLE_MAX,
      versionsMax: CANVAS_VERSIONS_MAX,
      perProjectMax: CANVAS_PER_PROJECT_MAX,
    },
  };
};
