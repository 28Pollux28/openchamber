import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * A lock nobody holds is reclaimed rather than waited on forever.
 *
 * The lock file names the process that took it. A waiter that finds the file
 * asks whether that process still exists on this machine; a crashed or killed
 * owner leaves a file that nobody will ever remove, and every store read would
 * otherwise fail with "busy" until someone deleted it by hand. A lock from
 * another machine, or one written before locks carried an owner, is reclaimed
 * only once it is old enough that no live writer could still be inside it.
 */
const STALE_LOCK_MS = 5 * 60_000;

const lockError = (lockPath, busy, cause) => Object.assign(new Error(
  `Source control lock ${path.basename(lockPath)} ${busy ? 'is busy' : 'failed'}. Retry in a moment.`,
  { cause },
), { code: busy ? 'SOURCE_CONTROL_LOCK_BUSY' : 'SOURCE_CONTROL_LOCK_FAILED', status: busy ? 503 : 500 });

const validateWait = (waitMs) => {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0) throw new TypeError('Invalid source control lock wait');
};

const ownerRecord = () => `${JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now(), nonce: randomUUID() })}\n`;

const processAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};

/** Whether a lock file's content and age say its owner is gone. */
const isAbandoned = (content, mtimeMs, now = Date.now()) => {
  let owner = null;
  try { owner = JSON.parse(String(content)); } catch { owner = null; }
  if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.host === os.hostname()) {
    return !processAlive(owner.pid);
  }
  return now - mtimeMs > STALE_LOCK_MS;
};

const releaseError = (lockPath, error) => lockError(lockPath, false, error);

// Like an index lock: only exclusive creation grants ownership. Age and PID
// decide only when an existing file may be removed to try again.

/**
 * Removes the abandoned lock that was inspected, and only that one.
 *
 * Two waiters can judge the same dead owner's lock at once. Removing it by
 * path would let the slower one delete the lock the faster one has just
 * created, and both would enter. The rename is atomic, so only one waiter
 * takes a given file; the taker then checks it took the inspected file and,
 * when it took a newer lock instead, links it back under its name (`link`
 * refuses to replace anything) before letting go of its own copy.
 */
const reclaimTarget = (lockPath) => `${lockPath}.reclaim-${randomUUID()}`;
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

async function reclaimAbandoned(fsImpl, lockPath, inspected) {
  const target = reclaimTarget(lockPath);
  try { await fsImpl.rename(lockPath, target); } catch { return; }
  try {
    if (!sameFile(await fsImpl.lstat(target, { bigint: true }), inspected)) {
      try { await fsImpl.link(target, lockPath); } catch {}
    }
  } finally {
    try { await fsImpl.unlink(target); } catch {}
  }
}

function reclaimAbandonedSync(fsImpl, lockPath, inspected) {
  const target = reclaimTarget(lockPath);
  try { fsImpl.renameSync(lockPath, target); } catch { return; }
  try {
    if (!sameFile(fsImpl.lstatSync(target, { bigint: true }), inspected)) {
      try { fsImpl.linkSync(target, lockPath); } catch {}
    }
  } finally {
    try { fsImpl.unlinkSync(target); } catch {}
  }
}

export async function withSourceControlFileLock(lockPath, operation, { fsImpl = fs, waitMs = 2_000 } = {}) {
  validateWait(waitMs);
  const deadline = performance.now() + waitMs;
  let handle;
  let reclaimed = false;
  try {
    await fsImpl.mkdir(path.dirname(lockPath), { recursive: true });
    while (!handle) {
      try {
        handle = await fsImpl.open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw lockError(lockPath, false, error);
        if (!reclaimed) {
          let inspected = null;
          try {
            const [content, stats] = await Promise.all([fsImpl.readFile(lockPath, 'utf8'), fsImpl.lstat(lockPath, { bigint: true })]);
            if (stats.isFile() && isAbandoned(content, Number(stats.mtimeMs))) inspected = stats;
          } catch { inspected = null; }
          if (inspected) {
            reclaimed = true;
            await reclaimAbandoned(fsImpl, lockPath, inspected);
            continue;
          }
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw lockError(lockPath, true, error);
        await delay(Math.min(20, remaining));
      }
    }
  } catch (error) {
    if (error?.code?.startsWith('SOURCE_CONTROL_LOCK_')) throw error;
    throw lockError(lockPath, false, error);
  }

  try {
    try {
      await handle.writeFile(ownerRecord(), 'utf8');
    } catch (error) {
      throw lockError(lockPath, false, error);
    }
    return await operation();
  } finally {
    try {
      // Keep the handle open through unlink so its inode cannot be reused.
      const owned = await handle.stat({ bigint: true });
      const current = await fsImpl.lstat(lockPath, { bigint: true });
      if (owned.dev !== current.dev || owned.ino !== current.ino) throw releaseError(lockPath);
      await fsImpl.unlink(lockPath);
    } catch (error) {
      throw releaseError(lockPath, error);
    } finally {
      try { await handle.close(); }
      catch (error) { throw releaseError(lockPath, error); }
    }
  }
}

const sleepSync = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

// Synchronous storage callers retain the same ownership contract.
export function withSourceControlFileLockSync(lockPath, operation, { fsImpl = fsSync, waitMs = 2_000 } = {}) {
  validateWait(waitMs);
  const deadline = performance.now() + waitMs;
  let handle;
  let reclaimed = false;
  try {
    fsImpl.mkdirSync(path.dirname(lockPath), { recursive: true });
    while (handle === undefined) {
      try {
        handle = fsImpl.openSync(lockPath, 'wx', 0o600);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw lockError(lockPath, false, error);
        if (!reclaimed) {
          let inspected = null;
          try {
            const stats = fsImpl.lstatSync(lockPath, { bigint: true });
            if (stats.isFile() && isAbandoned(fsImpl.readFileSync(lockPath, 'utf8'), Number(stats.mtimeMs))) inspected = stats;
          } catch { inspected = null; }
          if (inspected) {
            reclaimed = true;
            reclaimAbandonedSync(fsImpl, lockPath, inspected);
            continue;
          }
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw lockError(lockPath, true, error);
        sleepSync(Math.min(20, remaining));
      }
    }
  } catch (error) {
    if (error?.code?.startsWith('SOURCE_CONTROL_LOCK_')) throw error;
    throw lockError(lockPath, false, error);
  }

  try {
    try {
      fsImpl.writeFileSync(handle, ownerRecord(), 'utf8');
    } catch (error) {
      throw lockError(lockPath, false, error);
    }
    return operation();
  } finally {
    try {
      const owned = fsImpl.fstatSync(handle, { bigint: true });
      const current = fsImpl.lstatSync(lockPath, { bigint: true });
      if (owned.dev !== current.dev || owned.ino !== current.ino) throw releaseError(lockPath);
      fsImpl.unlinkSync(lockPath);
    } catch (error) {
      throw releaseError(lockPath, error);
    } finally {
      try { fsImpl.closeSync(handle); }
      catch (error) { throw releaseError(lockPath, error); }
    }
  }
}
