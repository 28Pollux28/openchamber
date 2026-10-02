/**
 * OpenChamber canvas routes, for the panel that renders canvases.
 *
 * The agent writes through its tool; these routes only read and delete. The
 * write path stays behind the tool so every canvas is a document the agent
 * composed and the user can trace to a turn.
 *
 * Content is served as JSON, not as HTML: the frame renders the document from
 * a sandboxed `srcDoc` the host builds, with its own Content-Security-Policy,
 * in direct and relay mode alike. Serving the bytes as `text/html` would give
 * agent-authored markup the app's own origin.
 *
 * `projectId` is a query parameter because the panel knows the project it is
 * showing; the agent path derives it from the session directory instead.
 */

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;
// Same shape the store accepts: the generator's `cv-<uuid>`, and the
// underscore form the generator briefly emitted.
const CANVAS_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;

const isValidationError = (error) => {
  const message = error instanceof Error ? error.message : '';
  return message.includes('is required')
    || message.includes('unsupported characters')
    || message.includes('positive integer');
};

const respondWithError = (res, error, fallbackMessage) => {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (isValidationError(error)) {
    return res.status(400).json({ error: message });
  }
  if (message.includes('malformed')) {
    return res.status(500).json({ error: message || fallbackMessage });
  }
  return res.status(500).json({ error: message || fallbackMessage });
};

/**
 * One scalar query parameter, or null: Express query values are
 * string | string[] | ParsedQs, and only a plain string is a parameter
 * here. Anything else — including a repeated name — is the caller's error
 * to report, never half of a pair.
 */
const queryText = (value) => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) || value instanceof Object) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

export const registerCanvasRoutes = (app, dependencies) => {
  const { canvasRuntime } = dependencies;

  const requireProjectId = (req, res) => {
    const projectId = queryText(req.query.projectId);
    if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
      res.status(400).json({ error: 'projectId is required' });
      return null;
    }
    return projectId;
  };

  const requireCanvasId = (req, res) => {
    const canvasId = queryText(req.params.canvasId);
    if (!canvasId || !CANVAS_ID_PATTERN.test(canvasId)) {
      res.status(400).json({ error: 'canvasId is required' });
      return null;
    }
    return canvasId;
  };

  app.get('/api/canvas', async (req, res) => {
    const projectId = requireProjectId(req, res);
    if (!projectId) return;
    try {
      return res.json({ canvases: await canvasRuntime.list(projectId) });
    } catch (error) {
      return respondWithError(res, error, 'Failed to list canvases');
    }
  });

  app.get('/api/canvas/:canvasId', async (req, res) => {
    const projectId = requireProjectId(req, res);
    if (!projectId) return;
    const canvasId = requireCanvasId(req, res);
    if (!canvasId) return;
    try {
      const canvas = await canvasRuntime.describe(projectId, canvasId);
      if (!canvas) {
        return res.status(404).json({ error: 'Canvas not found' });
      }
      return res.json({ canvas });
    } catch (error) {
      return respondWithError(res, error, 'Failed to read the canvas');
    }
  });

  app.get('/api/canvas/:canvasId/content', async (req, res) => {
    const projectId = requireProjectId(req, res);
    if (!projectId) return;
    const canvasId = requireCanvasId(req, res);
    if (!canvasId) return;
    const versionRaw = queryText(req.query.version);
    const version = versionRaw === null ? undefined : Number(versionRaw);
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
      return res.status(400).json({ error: 'version must be a positive integer' });
    }
    try {
      const result = await canvasRuntime.read(projectId, canvasId, version);
      if (!result) {
        return res.status(404).json({ error: 'Canvas not found' });
      }
      if (result.html === null) {
        return res.status(404).json({ error: 'That version is no longer stored' });
      }
      return res.json({
        canvas: {
          id: result.meta.id,
          title: result.meta.title,
          version: result.version,
          html: result.html,
        },
      });
    } catch (error) {
      return respondWithError(res, error, 'Failed to read the canvas');
    }
  });

  app.delete('/api/canvas/:canvasId', async (req, res) => {
    const projectId = requireProjectId(req, res);
    if (!projectId) return;
    const canvasId = requireCanvasId(req, res);
    if (!canvasId) return;
    try {
      const result = await canvasRuntime.remove(projectId, canvasId);
      if (!result.deleted) {
        return res.status(404).json({ error: 'Canvas not found' });
      }
      return res.json({ deleted: true });
    } catch (error) {
      return respondWithError(res, error, 'Failed to delete the canvas');
    }
  });
};
