/**
 * The `unsafe` switches simple-git needs to accept the server's own Git
 * environment.
 *
 * simple-git takes the environment only through `.env()`, and it refuses an
 * environment that names an editor, pager, SSH command, askpass program,
 * config path or `GIT_CONFIG_*` entry unless the matching switch is on. Git
 * inherits exactly those variables from the server process anyway; the
 * switches below are turned on only for the ones present, so passing the
 * environment explicitly changes nothing about them, while what the server
 * adds (the prompt guard, `SSH_AUTH_SOCK`) and removes (AppImage launcher
 * paths) finally reaches Git. Mirrors simple-git's own tables
 * (`@simple-git/argv-parser`).
 */

const ENV_SWITCHES = new Map([
  ['editor', 'allowUnsafeEditor'],
  ['git_askpass', 'allowUnsafeAskPass'],
  ['git_config_global', 'allowUnsafeConfigPaths'],
  ['git_config_system', 'allowUnsafeConfigPaths'],
  ['git_config_count', 'allowUnsafeConfigEnvCount'],
  ['git_config', 'allowUnsafeConfigPaths'],
  ['git_editor', 'allowUnsafeEditor'],
  ['git_exec_path', 'allowUnsafeConfigPaths'],
  ['git_external_diff', 'allowUnsafeDiffExternal'],
  ['git_pager', 'allowUnsafePager'],
  ['git_proxy_command', 'allowUnsafeGitProxy'],
  ['git_template_dir', 'allowUnsafeTemplateDir'],
  ['git_sequence_editor', 'allowUnsafeEditor'],
  ['git_ssh', 'allowUnsafeSshCommand'],
  ['git_ssh_command', 'allowUnsafeSshCommand'],
  ['pager', 'allowUnsafePager'],
  ['prefix', 'allowUnsafeConfigPaths'],
  ['ssh_askpass', 'allowUnsafeAskPass'],
]);

// Config keys a `GIT_CONFIG_KEY_<n>` entry may set. A dotted key also matches
// its subsection form (`credential.<url>.helper`), as in simple-git.
const exact = (key, flag) => ({ pattern: new RegExp(`\\s*${key.toLowerCase()}`), flag });
const sectioned = (key, flag) => ({ pattern: new RegExp(`\\s*${key.toLowerCase().replace(/\./g, '(..+)?.')}`), flag });
const CONFIG_SWITCHES = [
  exact('alias', 'allowUnsafeAlias'),
  exact('core.askPass', 'allowUnsafeAskPass'),
  exact('core.editor', 'allowUnsafeEditor'),
  exact('core.fsmonitor', 'allowUnsafeFsMonitor'),
  exact('core.gitProxy', 'allowUnsafeGitProxy'),
  exact('core.hooksPath', 'allowUnsafeHooksPath'),
  exact('core.pager', 'allowUnsafePager'),
  exact('core.sshCommand', 'allowUnsafeSshCommand'),
  sectioned('credential.helper', 'allowUnsafeCredentialHelper'),
  sectioned('diff.command', 'allowUnsafeDiffExternal'),
  exact('diff.external', 'allowUnsafeDiffExternal'),
  sectioned('diff.textconv', 'allowUnsafeDiffTextConv'),
  sectioned('filter.clean', 'allowUnsafeFilter'),
  sectioned('filter.smudge', 'allowUnsafeFilter'),
  sectioned('gpg.program', 'allowUnsafeGpgProgram'),
  exact('init.templateDir', 'allowUnsafeTemplateDir'),
  sectioned('merge.driver', 'allowUnsafeMergeDriver'),
  sectioned('mergetool.path', 'allowUnsafeMergeDriver'),
  sectioned('mergetool.cmd', 'allowUnsafeMergeDriver'),
  sectioned('protocol.allow', 'allowUnsafeProtocolOverride'),
  sectioned('remote.receivepack', 'allowUnsafePack'),
  sectioned('remote.uploadpack', 'allowUnsafePack'),
  exact('sequence.editor', 'allowUnsafeEditor'),
];

/** The switches the variables present in `env` need, all `true`. */
export const unsafeSwitchesForEnv = (env) => {
  const switches = {};
  const lowered = new Map(Object.entries(env).map(([name, value]) => [name.toLowerCase().trim(), value]));
  for (const [name, flag] of ENV_SWITCHES) {
    if (lowered.has(name)) switches[flag] = true;
  }
  const count = Number.parseInt(String(lowered.get('git_config_count') ?? '0'), 10);
  for (let index = 0; index < count; index += 1) {
    const key = lowered.get(`git_config_key_${index}`);
    if (key === undefined) continue;
    const normalized = String(key).toLowerCase().trim();
    for (const { pattern, flag } of CONFIG_SWITCHES) {
      if (pattern.test(normalized)) switches[flag] = true;
    }
  }
  return switches;
};
