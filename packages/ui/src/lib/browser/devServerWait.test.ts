import { describe, expect, test } from 'bun:test';

import {
  DEV_SERVER_WAIT_MS,
  forgetBrowserTabOpenedWithAddress,
  noteBrowserTabOpenedWithAddress,
  planFailedLoadRetry,
  requestBrowserTabLoad,
  subscribeBrowserTabLoadRequests,
  wasBrowserTabOpenedWithAddress,
} from './devServerWait';

const REFUSED = -102;
const DEAD_PORT = 'http://localhost:8481/';

describe('dev server wait', () => {
  test('a restored load that fails is not retried', () => {
    const plan = planFailedLoadRetry({ code: REFUSED, url: DEAD_PORT }, { run: null, restored: true, now: 1_000 });
    expect(plan.retry).toBe(false);
  });

  test('a load someone started is retried while the server comes up', () => {
    const first = planFailedLoadRetry({ code: REFUSED, url: DEAD_PORT }, { run: null, restored: false, now: 1_000 });
    expect(first).toEqual({ retry: true, run: { url: DEAD_PORT, startedAt: 1_000 } });

    const later = planFailedLoadRetry({ code: REFUSED, url: DEAD_PORT }, { run: first.run, restored: false, now: 20_000 });
    expect(later).toEqual({ retry: true, run: { url: DEAD_PORT, startedAt: 1_000 } });
  });

  test('the wait ends once the run has lasted the whole budget', () => {
    const run = { url: DEAD_PORT, startedAt: 1_000 };
    const plan = planFailedLoadRetry({ code: REFUSED, url: DEAD_PORT }, { run, restored: false, now: 1_001 + DEV_SERVER_WAIT_MS });
    expect(plan).toEqual({ retry: false, run });
  });

  test('a public site that refused is not retried', () => {
    const plan = planFailedLoadRetry({ code: REFUSED, url: 'https://example.com/' }, { run: null, restored: false, now: 1_000 });
    expect(plan.retry).toBe(false);
  });

  test('a tab opened with an address counts as opened now only until it has mounted', () => {
    const tabID = 'browser:http://localhost:8481/';
    expect(wasBrowserTabOpenedWithAddress('/repo', tabID)).toBe(false);

    noteBrowserTabOpenedWithAddress('/repo', tabID);
    expect(wasBrowserTabOpenedWithAddress('/repo', tabID)).toBe(true);
    expect(wasBrowserTabOpenedWithAddress('/repo', tabID)).toBe(true);
    // The same address in another project is a different tab.
    expect(wasBrowserTabOpenedWithAddress('/other', tabID)).toBe(false);

    forgetBrowserTabOpenedWithAddress('/repo', tabID);
    expect(wasBrowserTabOpenedWithAddress('/repo', tabID)).toBe(false);
  });

  test('a load request reaches only the mounted tab it names, until it unsubscribes', () => {
    const tabID = 'browser:http://localhost:5173/';
    const loads: string[] = [];
    const stop = subscribeBrowserTabLoadRequests('/repo', tabID, (url) => loads.push(url));

    requestBrowserTabLoad('/repo', tabID, 'http://localhost:5173/');
    requestBrowserTabLoad('/other', tabID, 'http://localhost:5173/');
    expect(loads).toEqual(['http://localhost:5173/']);

    stop();
    requestBrowserTabLoad('/repo', tabID, 'http://localhost:5173/');
    expect(loads).toEqual(['http://localhost:5173/']);
  });
});
