/**
 * Dispatch for the `canvas.*` actions the `openchamber_canvas` tool calls.
 *
 * Kept beside the store rather than inside the control service, like memory:
 * the control service owns sessions, schedules and the browser; canvas shares
 * none of that machinery and only needs the same envelope.
 *
 * Project scope is derived from the session's directory, never from the model.
 * The agent never types a project id, so a canvas it builds while working in a
 * worktree lands in the project the panel shows — not in a folder keyed by a
 * worktree path the user never opens.
 */

const asNonEmptyString = (value) => {
  // Inputs arrive from JSON tool bodies; null/undefined and anything
  // structured (objects, arrays) is not text, and every remaining scalar
  // reads as its own text.
  if (value === null || value === undefined || value instanceof Object) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** The document field is the one input a number must not satisfy. */
const isText = (value) => Object.prototype.toString.call(value) === '[object String]';

export const createCanvasActions = (dependencies) => {
  const {
    canvasRuntime,
    createError,
    onCanvasChanged,
    resolveProjectId: resolveProjectIdForDirectory,
  } = dependencies;

  const fail = (message, status = 400) => {
    throw createError(message, status);
  };

  /**
   * Announce a write so an open panel shows the new version without being
   * reopened. The agent writes here unprompted, so without this the user only
   * learns a canvas changed the next time something happens to reload.
   *
   * Never allowed to fail the action: the canvas is already on disk, and a
   * broken notification must not report the write as failed.
   */
  const announce = (projectId, canvasId) => {
    try {
      onCanvasChanged({ projectId, canvasId });
    } catch {
      // A listener that throws must not take the write down with it.
    }
  };

  const resolveProject = async (contextDirectory) => {
    const directory = asNonEmptyString(contextDirectory);
    const projectId = directory ? await resolveProjectIdForDirectory(directory) : '';
    if (!projectId) {
      fail('Canvas needs a session directory, and this session has none', 400);
    }
    return projectId;
  };

  const toSummary = (canvas) => ({
    canvasId: canvas.id,
    title: canvas.title,
    version: canvas.version,
    updatedAt: canvas.updatedAt,
  });

  const update = async (input, contextDirectory) => {
    const projectId = await resolveProject(contextDirectory);
    const title = asNonEmptyString(input.title);
    if (!title) fail('title is required for canvas.update', 400);
    const canvasId = asNonEmptyString(input.canvasId);
    const html = isText(input.html) ? input.html : null;
    if (input.html !== undefined && html === null) fail('html must be a string', 400);
    if (!canvasId && !html) fail('html is required for canvas.update', 400);

    try {
      let result = null;
      if (canvasId) {
        const patch = html === null ? { title } : { title, html };
        result = await canvasRuntime.update(projectId, canvasId, patch);
      } else {
        result = await canvasRuntime.create(projectId, { title, html });
      }
      if (!result) {
        fail('No canvas has that id in this project', 404);
      }
      announce(projectId, result.id);
      // The document is not echoed back. Handing the model what it just wrote
      // costs context for nothing; the id and version are what a later
      // canvas.read or canvas.update needs.
      return {
        id: result.id,
        title: result.title,
        version: result.version,
        created: !canvasId,
        // Told plainly so the agent says "updated the canvas" and not "made a
        // new one" when it passed an id, and so prose links use the one
        // scheme the app opens in place — any invented scheme runs the trust
        // dialog and then fails on the desktop shell.
        hint: 'The canvas is saved and a card in your reply opens it for the user. Reference it in prose with a canvas:<id> link when you need a link. Ask for changes with another canvas.update using the same id; each call is a new version.',
      };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 400);
    }
  };

  const list = async (input, contextDirectory) => {
    const projectId = await resolveProject(contextDirectory);
    try {
      const canvases = await canvasRuntime.list(projectId);
      return { canvases: canvases.map(toSummary) };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 500);
    }
  };

  const read = async (input, contextDirectory) => {
    const projectId = await resolveProject(contextDirectory);
    const canvasId = asNonEmptyString(input.canvasId);
    if (!canvasId) fail('canvasId is required for canvas.read', 400);
    const version = input.version === undefined || input.version === null
      ? undefined
      : Number(input.version);
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
      fail('version must be a positive integer', 400);
    }

    try {
      const result = await canvasRuntime.read(projectId, canvasId, version);
      if (!result) {
        fail('No canvas has that id in this project', 404);
      }
      if (result.html === null) {
        fail(`Version ${result.version} of that canvas is no longer stored; read without version for the latest`, 404);
      }
      return {
        id: result.meta.id,
        title: result.meta.title,
        version: result.version,
        html: result.html,
      };
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 500);
    }
  };

  const execute = async (action, input = {}, contextDirectory) => {
    switch (action) {
      case 'canvas.update': return update(input, contextDirectory);
      case 'canvas.list': return list(input, contextDirectory);
      case 'canvas.read': return read(input, contextDirectory);
      default: return fail(`Unsupported canvas action: ${action || 'missing'}`, 400);
    }
  };

  return { execute };
};
