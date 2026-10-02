/**
 * OpenChamber canvas API — the panel's read and delete paths.
 *
 * The agent writes through its tool (`openchamber_canvas`), so there is no
 * create or update here; the panel reads canvases back, and can delete one.
 * Every call is OpenChamber HTTP through `runtimeFetch`, so direct and relay
 * runtimes both work.
 *
 * `projectId` is the client's path-derived project id (`createProjectIdFromPath`),
 * which the server stores canvases under through the same derivation — see
 * `lib/canvas/store.js` on the server.
 */

import { z } from 'zod';

import { runtimeFetch } from './runtime-fetch';

const BASE_PATH = '/api/canvas';

const canvasSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  version: z.number().int().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CanvasSummary = z.infer<typeof canvasSummarySchema>;

const canvasVersionSchema = z.object({
  n: z.number().int().min(1),
  size: z.number().int().min(0),
  createdAt: z.number(),
});

const canvasDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  version: z.number().int().min(1),
  versions: z.array(canvasVersionSchema),
});
export type CanvasDetail = z.infer<typeof canvasDetailSchema>;

const canvasContentSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  version: z.number().int().min(1),
  html: z.string(),
});
type CanvasContent = z.infer<typeof canvasContentSchema>;
/** The tool result envelope the chat card renders from. */
const canvasToolResultSchema = z.object({
  schemaVersion: z.number(),
  ok: z.boolean(),
  action: z.string(),
  data: z.object({
    id: z.string(),
    title: z.string(),
    version: z.number().int().min(1),
    created: z.boolean().optional(),
    hint: z.string().optional(),
  }).optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type CanvasToolResult = z.infer<typeof canvasToolResultSchema>;

class CanvasUnavailableError extends Error {}

const canvasListBodySchema = z.object({ canvases: z.array(canvasSummarySchema) });
const canvasDetailBodySchema = z.object({ canvas: canvasDetailSchema });
const canvasContentBodySchema = z.object({ canvas: canvasContentSchema });

/**
 * Parses one response body and validates it with the caller's schema in the
 * same step, so no untyped value ever escapes this function. A body that is
 * not JSON and a body of the wrong shape are distinct transport errors.
 */
const parseBody = async <S extends z.ZodTypeAny>(response: Response, schema: S): Promise<z.output<S>> => {
  const text = await response.text();
  let value: unknown;
  try {
    // SAFETY: JSON.parse's own result is the boundary value; the schema
    // below is the only thing that turns it into a domain type.
    value = JSON.parse(text);
  } catch {
    throw new CanvasUnavailableError('The server answered with invalid JSON');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CanvasUnavailableError('The server answered in an unexpected shape');
  }
  return parsed.data;
};

/** List a project's canvases, newest change first. */
export const listCanvases = async (projectId: string): Promise<CanvasSummary[]> => {
  // no-store everywhere: a canvas the agent just rewrote must never come
  // from the browser's HTTP cache, whatever heuristic caching makes of an
  // unmarked JSON response.
  const response = await runtimeFetch(`${BASE_PATH}?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new CanvasUnavailableError(`Canvases returned ${response.status}`);
  }
  return (await parseBody(response, canvasListBodySchema)).canvases;
};

/** One canvas's metadata and version history. */
export const fetchCanvas = async (projectId: string, canvasId: string): Promise<CanvasDetail | null> => {
  const response = await runtimeFetch(`${BASE_PATH}/${encodeURIComponent(canvasId)}?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new CanvasUnavailableError(`The canvas returned ${response.status}`);
  }
  return (await parseBody(response, canvasDetailBodySchema)).canvas;
};

/** One version's document. A pruned version answers 404, not a failure. */
export const fetchCanvasContent = async (
  projectId: string,
  canvasId: string,
  version?: number,
): Promise<CanvasContent | null> => {
  const query = version === undefined ? '' : `&version=${version}`;
  const response = await runtimeFetch(`${BASE_PATH}/${encodeURIComponent(canvasId)}/content?projectId=${encodeURIComponent(projectId)}${query}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new CanvasUnavailableError(`The canvas returned ${response.status}`);
  }
  return (await parseBody(response, canvasContentBodySchema)).canvas;
};

export const deleteCanvas = async (projectId: string, canvasId: string): Promise<boolean> => {
  const response = await runtimeFetch(`${BASE_PATH}/${encodeURIComponent(canvasId)}?projectId=${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new CanvasUnavailableError(`Deleting the canvas returned ${response.status}`);
  }
  return true;
};

/**
 * The tool call's result text as the envelope the chat card renders.
 * Everything else (unparseable JSON, wrong shape) is a null: the card shows
 * its fallback rather than guessing.
 */
/**
 * The tool call's result text as the envelope the chat card renders.
 * Everything else (unparseable JSON, wrong shape) is a null: the card shows
 * its fallback rather than guessing.
 */
export const parseCanvasToolResult = (content: string | null | undefined): CanvasToolResult | null => {
  if (content === null || content === undefined || content.trim().length === 0) return null;
  let value: unknown;
  try {
    // SAFETY: JSON.parse of tool output; the schema decides what survives.
    value = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = canvasToolResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
