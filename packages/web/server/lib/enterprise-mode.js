/**
 * Enterprise mode: an administrator's promise that conversation content goes
 * only to the model providers configured in OpenCode. Set through
 * `OPENCHAMBER_ENTERPRISE_MODE=1` (or `true`) in the server's environment,
 * which includes the login-shell snapshot, so nothing in the UI can turn it
 * off. Read at every use.
 *
 * Each feature that could send conversation content anywhere else checks it
 * at its own server boundary:
 * - Model providers come only from the OpenCode config: connecting one,
 *   signing in, adding a key or creating a custom provider through this
 *   server is refused (`opencode/routes.js`). OpenCode's `provider.use`
 *   policy is the real lock; this closes the way in through the app.
 * - Jev classification is off, unless the administrator pinned their own
 *   endpoint with `OPENCHAMBER_JEV_URL` (`routing/runtime.js`).
 * - External tunnels are refused: their provider sees plain text (`tunnels`).
 * - The private relay runs only on a self-hosted endpoint pinned by
 *   `OPENCHAMBER_RELAY_URL` (`relay/service.js`).
 * - Speech and transcription go only to servers on this machine (`tts`,
 *   `dictation`).
 * - Push notifications carry no message text or session name (`notifications`).
 * - Update checks still run but never report usage (`package-manager.js`).
 */
export const isEnterpriseMode = (env = process.env) => {
  const value = (env.OPENCHAMBER_ENTERPRISE_MODE ?? '').trim().toLowerCase();
  return value === '1' || value === 'true';
};

export const ENTERPRISE_MODE_ERROR = 'Not available in enterprise mode: this server keeps conversations with the model providers configured in OpenCode.';
