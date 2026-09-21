import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitRepositoryCredentialRuntime } from './repository-credential-runtime.js';
import { createHttpsCredentialReference } from './credential-resolver.js';

const GITHUB = 'https://github.com/owner/repo.git';
const endpoint = (displayUrl) => ({ displayUrl, fingerprint: `fp:${displayUrl}` });
const grant = (overrides = {}) => ({
  name: 'origin', mode: 'managed', credentialId: createHttpsCredentialReference({ provider: 'github', instance: 'github.com', credentialId: 'cred', credentialRevision: 1, providerUserId: 'github.com#42' }), readiness: 'ready',
  fetch: endpoint(GITHUB), push: endpoint(GITHUB), ...overrides,
});
const read = (remotes) => ({
  status: remotes ? 'bound' : 'missing', revision: 1,
  repository: { repositoryId: 'repo_one', configRevision: 'c1', remotes: [{ name: 'origin', fetch: endpoint(GITHUB), push: endpoint(GITHUB) }] },
  binding: remotes ? { repositoryId: 'repo_one', revision: 1, providers: [], remotes, auxiliary: [] } : null,
});

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const setup = async ({ binding = read([grant()]), resolve = async () => ({ transport: 'https', username: 'x-access-token', password: 'secret-value' }), port = 4399 } = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-repo-credential-'));
  roots.push(dataDir);
  const resolved = [];
  const runtime = createGitRepositoryCredentialRuntime({
    readBinding: async (directory) => { if (directory === '/not-a-repo') throw new Error('nope'); return binding; },
    credentialResolver: { resolve: async (input) => { resolved.push(input); return resolve(input); } },
    dataDir, fsPromises: fs,
    getActivePort: () => port,
    helperPath: '/opt/openchamber/repository-credential-helper.js',
  });
  return { runtime, dataDir, resolved };
};

const ask = async (runtime, { secret, body, remoteAddress = '127.0.0.1' }) => {
  let handler;
  runtime.registerRoutes({ post: (_path, route) => { handler = route; } });
  let status = 200;
  let answer;
  await handler(
    { socket: { remoteAddress }, headers: { authorization: `Bearer ${secret}` }, body },
    { set: () => {}, status: (code) => { status = code; return { end: () => {} }; }, json: (value) => { answer = value; } },
  );
  return { status, answer };
};

const readEndpoint = async (dataDir) => JSON.parse(await fs.readFile(path.join(dataDir, 'git-credential-endpoint.json'), 'utf8'));

describe('createGitRepositoryCredentialRuntime', () => {
  it('publishes a private endpoint file and a launcher, and names the launcher as the helper', async () => {
    const { runtime, dataDir } = await setup();
    await runtime.publish();
    const published = await readEndpoint(dataDir);
    expect(published).toEqual({ version: 1, url: 'http://127.0.0.1:4399/api/git/repository-credential', secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect((await fs.stat(path.join(dataDir, 'git-credential-endpoint.json'))).mode & 0o777).toBe(0o600);
    const launcher = await fs.readFile(path.join(dataDir, 'bin', 'git-credential-openchamber'), 'utf8');
    expect(launcher).toContain(`'/opt/openchamber/repository-credential-helper.js' '${path.join(dataDir, 'git-credential-endpoint.json')}' "$@"`);
    expect((await fs.stat(path.join(dataDir, 'bin', 'git-credential-openchamber'))).mode & 0o777).toBe(0o700);
    expect(runtime.helperCommand()).toBe(`!'${path.join(dataDir, 'bin', 'git-credential-openchamber')}'`);
  });

  it('answers the bound account credential for the repository the helper runs in', async () => {
    const { runtime, dataDir, resolved } = await setup();
    await runtime.publish();
    const { secret } = await readEndpoint(dataDir);
    const { answer } = await ask(runtime, { secret, body: { cwd: '/repo', query: 'protocol=https\nhost=github.com\n' } });
    expect(answer).toEqual({ mode: 'managed', username: 'x-access-token', password: 'secret-value' });
    expect(resolved[0]).toMatchObject({ mode: 'managed', endpoint: { protocol: 'https', host: 'github.com', path: '/owner/repo.git' } });
  });

  it('hands System, unbound and unmatched repositories back to the machine, and a lost credential to nobody', async () => {
    const body = { cwd: '/repo', query: 'protocol=https\nhost=github.com\n' };
    for (const [binding, mode] of [
      [read([grant({ mode: 'system', credentialId: undefined })]), 'system'],
      [read(null), 'system'],
      [read([grant({ fetch: endpoint('https://gitlab.com/o/r.git'), push: endpoint('https://gitlab.com/o/r.git') })]), 'system'],
    ]) {
      const { runtime, dataDir } = await setup({ binding });
      await runtime.publish();
      expect((await ask(runtime, { secret: (await readEndpoint(dataDir)).secret, body })).answer).toEqual({ mode });
    }
    const gone = await setup({ resolve: async () => { throw new Error('account unavailable'); } });
    await gone.runtime.publish();
    expect((await ask(gone.runtime, { secret: (await readEndpoint(gone.dataDir)).secret, body })).answer).toEqual({ mode: 'none' });
  });

  it('refuses a wrong secret, a request before publishing, and another machine', async () => {
    const { runtime, dataDir } = await setup();
    const body = { cwd: '/repo', query: 'protocol=https\nhost=github.com\n' };
    expect((await ask(runtime, { secret: 'anything', body })).status).toBe(403);
    await runtime.publish();
    const { secret } = await readEndpoint(dataDir);
    expect((await ask(runtime, { secret: 'wrong', body })).status).toBe(403);
    expect((await ask(runtime, { secret, body, remoteAddress: '192.168.1.20' })).status).toBe(403);
  });

  it('drives the real helper script: managed answers the credential, system falls through', async () => {
    const { runtime, dataDir } = await setup();
    const app = express();
    app.use(express.json());
    let mode = 'managed';
    app.post('/api/git/repository-credential', (req, res) => {
      const secretOk = req.headers.authorization === `Bearer ${JSON.parse(String(process.env.__ENDPOINT_JSON)).secret}`;
      if (!secretOk) return res.status(403).end();
      res.json(mode === 'managed' ? { mode, username: 'x-access-token', password: 'secret-value' } : { mode });
    });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const endpointFile = path.join(dataDir, 'git-credential-endpoint.json');
      const endpointJson = JSON.stringify({ version: 1, url: `http://127.0.0.1:${server.address().port}/api/git/repository-credential`, secret: 'test-secret' });
      await fs.writeFile(endpointFile, endpointJson);
      process.env.__ENDPOINT_JSON = endpointJson;
      const helper = new URL('./repository-credential-helper.js', import.meta.url).pathname;
      const run = () => new Promise((resolve) => {
        const child = execFile(process.execPath, [helper, endpointFile, 'get'], {
          env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HOME: dataDir },
        }, (_error, stdout) => resolve(stdout));
        child.stdin.end('protocol=https\nhost=github.com\n');
      });
      expect(await run()).toBe('username=x-access-token\npassword=secret-value\n\n');
      // System: the person's own chain is asked, which here holds nothing.
      mode = 'system';
      expect(await run()).toBe('');
      // A server that is not there: the same fall-through, never a hang.
      await fs.writeFile(endpointFile, JSON.stringify({ version: 1, url: 'http://127.0.0.1:1/api/git/repository-credential', secret: 's' }));
      expect(await run()).toBe('');
    } finally {
      delete process.env.__ENDPOINT_JSON;
      await new Promise((resolve) => server.close(resolve));
    }
    void runtime;
  });
});
