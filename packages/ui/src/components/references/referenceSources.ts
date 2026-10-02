/**
 * Where the picker's lists and previews come from, one cache per kind of
 * answer. Cache keys carry the runtime, the account and the project, so a
 * different account or host never sees another one's list.
 *
 * GitHub items are read with the repository's read context: the account its
 * binding names, or the current github.com account for a repository nobody
 * bound, the same one the Git view reads with.
 */

import * as React from 'react';

import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import type {
    GitHubReference,
    GitHubReferenceDetail,
    GitHubReferenceFilter,
    GitHubReferenceKind,
    LinearAPI,
    LinearIssue,
    LinearIssueSummary,
    SourceControlReadContext,
} from '@/lib/api/types';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { GITHUB_SOURCE_CONTROL_IDENTITY } from '@/lib/source-control/identity';
import { useRepositoryBinding } from '@/lib/source-control/repository-binding';
import { useLinearAuthStore } from '@/stores/useLinearAuthStore';
import { useSourceControlAuthEntry } from '@/stores/useSourceControlAuthStore';

import { createListCache, createValueCache, useCachedList, useCachedValue, type ListPage } from './referenceCache';
import type { LinearReferenceFilter } from './referencePickerItems';

const githubLists = createListCache<GitHubReference>();
const linearLists = createListCache<LinearIssueSummary>();
const linearDetails = createValueCache<LinearIssue>();
const githubDetails = createValueCache<GitHubReferenceDetail>();

export type ReferenceSourceStatus = 'ready' | 'disconnected' | 'unsupported';

/** Whether GitHub can list here: no account at all reads as disconnected. */
export function useGitHubSourceStatus(): ReferenceSourceStatus {
    const { runtime } = useRuntimeAPIs();
    const auth = useSourceControlAuthEntry(GITHUB_SOURCE_CONTROL_IDENTITY);
    if (runtime.isVSCode) return 'unsupported';
    return auth?.hasChecked && auth.status?.connected !== true ? 'disconnected' : 'ready';
}

/**
 * The GitHub read context of a project, once its binding has been read: null
 * while it loads, and `missing` when the project has no GitHub remote or no
 * account to read it with.
 */
export function useGitHubReadContext(directory: string | null): SourceControlReadContext | 'missing' | null {
    const { sourceControl } = useRuntimeAPIs();
    const binding = useRepositoryBinding(directory, sourceControl, Boolean(directory));
    const context = binding.contexts.find((candidate) => candidate.provider === 'github') ?? null;
    if (context) return context;
    return binding.status === 'ready' || binding.status === 'error' ? 'missing' : null;
}

export function useLinearSourceStatus(): ReferenceSourceStatus {
    const { linear } = useRuntimeAPIs();
    const checked = useLinearAuthStore((state) => state.hasChecked);
    const connected = useLinearAuthStore((state) => state.status?.connected === true);
    if (!linear) return 'unsupported';
    return checked && !connected ? 'disconnected' : 'ready';
}

export function useGitHubReferenceList(options: {
    enabled: boolean;
    directory: string | null;
    kind: GitHubReferenceKind;
    filter: GitHubReferenceFilter;
    query: string;
}) {
    const { sourceControl } = useRuntimeAPIs();
    const { enabled, directory, kind, filter, query } = options;
    const context = useGitHubReadContext(enabled ? directory : null);
    const text = query.trim();
    const account = context && context !== 'missing' ? context.accountId : '';
    const key = enabled && directory && context
        ? JSON.stringify([getRuntimeKey(), account, directory, kind, filter, text])
        : null;
    const fetchPage = React.useCallback(async (cursor: string | null): Promise<ListPage<GitHubReference>> => {
        if (!context || context === 'missing') return { kind: 'unavailable', reason: 'no-repo' };
        const result = await sourceControl.githubReferences(context, { kind, filter, query: text, cursor });
        if (!result.connected) return { kind: 'unavailable', reason: 'disconnected' };
        if (!result.repo) return { kind: 'unavailable', reason: 'no-repo' };
        return { kind: 'page', items: result.items, cursor: result.cursor, hasMore: result.hasMore };
    }, [context, filter, kind, sourceControl, text]);
    return useCachedList(githubLists, key, fetchPage);
}

export function useLinearReferenceList(options: { enabled: boolean; filter: LinearReferenceFilter; query: string }) {
    const { linear } = useRuntimeAPIs();
    const workspace = useLinearAuthStore((state) => state.status?.organization?.id ?? '');
    const { enabled, filter, query } = options;
    const text = query.trim();
    const key = enabled && linear ? JSON.stringify([getRuntimeKey(), workspace, filter, text]) : null;
    const fetchPage = React.useCallback(async (cursor: string | null): Promise<ListPage<LinearIssueSummary>> => {
        if (!linear) return { kind: 'unavailable', reason: 'disconnected' };
        const result = await linear.issuesList({
            query: text || undefined,
            cursor: cursor ?? undefined,
            assignee: filter === 'assigned' ? 'me' : 'any',
        });
        if (result.connected === false) return { kind: 'unavailable', reason: 'disconnected' };
        return { kind: 'page', items: result.issues ?? [], cursor: result.cursor ?? null, hasMore: Boolean(result.hasMore) };
    }, [filter, linear, text]);
    return useCachedList(linearLists, key, fetchPage);
}

/** Comments of the previewed issue or PR, and a PR's size, review and checks. */
export function useGitHubReferenceDetail(directory: string | null, reference: GitHubReference | null) {
    const { sourceControl } = useRuntimeAPIs();
    const context = useGitHubReadContext(reference ? directory : null);
    const owner = reference?.sourceRepo.owner ?? '';
    const repo = reference?.sourceRepo.repo ?? '';
    const number = reference?.number ?? 0;
    const key = directory && reference && context && context !== 'missing'
        ? JSON.stringify([getRuntimeKey(), context.accountId, directory, owner, repo, number])
        : null;
    const fetch = React.useCallback(async (): Promise<GitHubReferenceDetail> => {
        if (!context || context === 'missing') throw new Error('GitHub is not available here');
        const result = await sourceControl.githubReferenceDetail(context, { owner, repo, number });
        if (!result.connected) throw new Error('GitHub is not connected');
        if (!result.detail) throw new Error('Not found');
        return result.detail;
    }, [context, number, owner, repo, sourceControl]);
    return useCachedValue(githubDetails, key, fetch);
}

const linearDetailKey = (workspace: string, issueId: string) => JSON.stringify([getRuntimeKey(), workspace, issueId]);

const fetchLinearIssue = async (linear: LinearAPI, issueId: string): Promise<LinearIssue> => {
    const result = await linear.issueGet(issueId);
    if (result.connected === false) throw new Error('Linear is not connected');
    if (!result.issue) throw new Error('Issue not found');
    return result.issue;
};

/**
 * A Linear issue with its description and comments, from the same cache the
 * preview fills: attaching an issue that was previewed asks Linear nothing.
 */
export function readLinearIssueDetail(linear: LinearAPI, issueId: string): Promise<LinearIssue> {
    const workspace = useLinearAuthStore.getState().status?.organization?.id ?? '';
    return linearDetails.ensure(linearDetailKey(workspace, issueId), () => fetchLinearIssue(linear, issueId));
}

/** The previewed Linear issue's description and comments. */
export function useLinearIssueDetail(issueId: string | null) {
    const { linear } = useRuntimeAPIs();
    const workspace = useLinearAuthStore((state) => state.status?.organization?.id ?? '');
    const key = issueId && linear ? linearDetailKey(workspace, issueId) : null;
    const fetch = React.useCallback(async () => {
        if (!linear || !issueId) throw new Error('Linear is not available here');
        return fetchLinearIssue(linear, issueId);
    }, [issueId, linear]);
    return { detail: useCachedValue(linearDetails, key, fetch) };
}
