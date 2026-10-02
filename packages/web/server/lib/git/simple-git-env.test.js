import { describe, expect, it } from 'vitest';
import simpleGit from 'simple-git';
import { unsafeSwitchesForEnv } from './simple-git-env.js';

describe('unsafeSwitchesForEnv', () => {
  it('turns on only the switches the present variables need', () => {
    expect(unsafeSwitchesForEnv({ PATH: '/usr/bin', HOME: '/home/me' })).toEqual({});
    expect(unsafeSwitchesForEnv({ GIT_EDITOR: 'vim', PAGER: 'less', PREFIX: '/opt' })).toEqual({
      allowUnsafeEditor: true,
      allowUnsafePager: true,
      allowUnsafeConfigPaths: true,
    });
  });

  it('covers config entries set through GIT_CONFIG_COUNT', () => {
    expect(unsafeSwitchesForEnv({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://example.com.helper',
      GIT_CONFIG_VALUE_0: 'store',
      GIT_CONFIG_KEY_1: 'user.name',
      GIT_CONFIG_VALUE_1: 'Me',
    })).toEqual({ allowUnsafeConfigEnvCount: true, allowUnsafeCredentialHelper: true });
  });

  // simple-git checks the environment when a task runs; this is the contract
  // the switches exist for.
  it('lets simple-git run with an environment carrying those variables', async () => {
    const env = { ...process.env, GIT_EDITOR: 'true', PAGER: 'cat', GIT_SSH_COMMAND: 'ssh' };
    await expect(simpleGit({ unsafe: unsafeSwitchesForEnv(env) }).env(env).raw(['--version'])).resolves.toMatch(/git version/);
    await expect(simpleGit().env(env).raw(['--version'])).rejects.toThrow(/not permitted/);
  });
});
