import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  fetchCanvas,
  fetchCanvasContent,
  type CanvasDetail,
} from '@/lib/canvasApi';
import { buildCanvasDocument } from '@/lib/canvasFrame';
import { createProjectIdFromPath } from '@/lib/projectId';
import { useI18n } from '@/lib/i18n';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { useUIStore } from '@/stores/useUIStore';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useProjectContextOwner } from '@/hooks/useProjectContextOwner';

/**
 * The Canvas viewer: one agent-built document, sandboxed.
 *
 * The canvas list lives in `useCanvasStore`; the document is fetched per
 * version and held here. The frame is `sandbox="allow-scripts"` with no
 * same-origin and renders the document from `srcDoc` with the host's CSP
 * (see `lib/canvasFrame.ts`), so the agent's markup runs with no origin, no
 * popups, and no way back to the API. `srcDoc` also carries the document
 * through the relay unchanged.
 *
 * An update while the tab is open re-reads when the user is on the latest
 * version; someone reading an older version is not yanked forward — that
 * version may be exactly what they are checking.
 */

type CanvasViewProps = {
  directory: string | null;
  canvasId: string;
  visible: boolean;
};

const CanvasDocumentFrame: React.FC<{ html: string; title: string; themeCss: string; version: number }> = ({ html, title, themeCss, version }) => {
  const document = React.useMemo(() => buildCanvasDocument(html, { themeCss }), [html, themeCss]);
  return (
    <iframe
      // Remount on a version change instead of a srcDoc swap: the new
      // document then starts from its own load, not from whatever scroll
      // state the previous version left, and a stale frame is impossible.
      key={version}
      sandbox="allow-scripts"
      srcDoc={document}
      title={title}
      className="h-full w-full border-0 bg-background"
    />
  );
};

const SourceView: React.FC<{ html: string }> = ({ html }) => (
  <div className="h-full overflow-auto p-3">
    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground">{html}</pre>
  </div>
);

// The host fonts, read the same way the guest frames read them. This only
// runs inside the mounted viewer, so `document` is always there.
const HOST_FONT_FALLBACK = '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const HOST_MONO_FALLBACK = 'ui-monospace, "SFMono-Regular", "Menlo", "Cascadia Mono", "Segoe UI Mono", monospace';

const readCssVar = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

/**
 * OpenChamber's theme for a canvas document: the current theme's colors and
 * fonts as CSS variables, injected ahead of the author's own styles.
 *
 * The page chrome — background, text color, font — carries `!important` on
 * purpose: author styles land later in the cascade and would otherwise
 * repaint the document into a foreign shell (models write their own dark
 * page backgrounds readily). Charts and cards keep full color freedom; only
 * the page itself stays the app's.
 *
 * The variables are namespaced (`--oc-*`), so they cannot collide with
 * whatever the agent wrote, and a theme change re-renders the frame with the
 * new values. The model is told these exist.
 */
const canvasThemeCss = (theme: ReturnType<typeof useThemeSystem>['currentTheme']): string => {
  const surface = theme.colors.surface;
  const lines = [
    `--oc-background: ${surface.background};`,
    `--oc-foreground: ${surface.foreground};`,
    `--oc-muted: ${surface.muted};`,
    `--oc-muted-foreground: ${surface.mutedForeground};`,
    `--oc-elevated: ${surface.elevated};`,
    `--oc-elevated-foreground: ${surface.elevatedForeground};`,
    `--oc-subtle: ${surface.subtle};`,
    `--oc-border: ${theme.colors.interactive.border};`,
    `--oc-primary: ${theme.colors.primary.base};`,
    `--oc-primary-foreground: ${theme.colors.primary.foreground ?? '#ffffff'};`,
    `--oc-success: ${theme.colors.status.success};`,
    `--oc-warning: ${theme.colors.status.warning};`,
    `--oc-error: ${theme.colors.status.error};`,
    `--oc-info: ${theme.colors.status.info};`,
    `--oc-font: ${readCssVar('--font-sans', HOST_FONT_FALLBACK)};`,
    `--oc-mono: ${readCssVar('--font-mono', HOST_MONO_FALLBACK)};`,
    `--oc-radius: ${readCssVar('--radius', '0.5625rem')};`,
  ];
  return [
    ':root {',
    ...lines.map((line) => `  ${line}`),
    '}',
    // The page itself is the app's, whatever the author writes later.
    'html, body {',
    '  background: var(--oc-background) !important;',
    '  color: var(--oc-foreground) !important;',
    '  font-family: var(--oc-font) !important;',
    '}',
  ].join('\n');
};

export const CanvasView: React.FC<CanvasViewProps> = ({ directory, canvasId, visible }) => {
  const { t } = useI18n();
  const { currentTheme } = useThemeSystem();
  const openCanvasTab = useUIStore((state) => state.openCanvasTab);
  const storeLoad = useCanvasStore((state) => state.load);
  const storeDeleteCanvas = useCanvasStore((state) => state.deleteCanvas);
  const canvases = useCanvasStore((state) => state.canvases);
  const owner = useProjectContextOwner(directory);
  const projectId = owner ? createProjectIdFromPath(owner.path) : null;

  const [detail, setDetail] = React.useState<CanvasDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Only the newest detail read may write: two updates in a row start two
  // reads, and an older answer landing later would rewind the viewer to the
  // placeholder version the newer one had already replaced.
  const detailSequenceRef = React.useRef(0);
  // The version the tab is on: null means "latest" — a detail read whose
  // version moved under us resolves to the newest document.
  const [selectedVersion, setSelectedVersion] = React.useState<number | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [contentLoading, setContentLoading] = React.useState(false);
  const [contentError, setContentError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'rendered' | 'source'>('rendered');

  const loadDetail = React.useCallback(async (freshProjectId: string | null, id: string) => {
    if (!freshProjectId) {
      detailSequenceRef.current += 1;
      setDetail(null);
      setGone(true);
      setLoading(false);
      return;
    }
    const requestId = ++detailSequenceRef.current;
    setLoading(true);
    setGone(false);
    setError(null);
    try {
      const next = await fetchCanvas(freshProjectId, id);
      if (requestId !== detailSequenceRef.current) return;
      if (next) {
        setDetail(next);
      } else {
        setDetail(null);
        setGone(true);
      }
    } catch (caught) {
      if (requestId !== detailSequenceRef.current) return;
      setDetail(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === detailSequenceRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setSelectedVersion(null);
    setContent(null);
    setContentError(null);
    void loadDetail(projectId, canvasId);
  }, [canvasId, loadDetail, projectId]);

  // The list backs the canvas picker; loading it here means it is only ever
  // read while a canvas tab is in front of the user.
  React.useEffect(() => {
    if (!projectId || !visible) return;
    void storeLoad(projectId);
  }, [projectId, storeLoad, visible]);

  // Coming back to the tab revalidates: updates that landed while the tab
  // was in the background fired no event into this viewer, so the shown
  // document could be a version the agent replaced minutes ago.
  React.useEffect(() => {
    if (!visible) return;
    void loadDetail(projectId, canvasId);
  }, [canvasId, loadDetail, projectId, visible]);

  React.useEffect(() => {
    if (!projectId || !detail) return;
    let cancelled = false;
    const run = async () => {
      // `null` selectedVersion means the latest, read from this detail
      // snapshot; a version pruned between detail and content read falls
      // back to the latest rather than an empty frame.
      const requested = selectedVersion ?? detail.version;
      setContentLoading(true);
      setContentError(null);
      try {
        const next = await fetchCanvasContent(projectId, canvasId, requested);
        if (cancelled) return;
        if (!next) {
          if (requested !== detail.version) {
            setSelectedVersion(null);
            const fresh = await fetchCanvasContent(projectId, canvasId, detail.version);
            if (!cancelled && fresh) setContent(fresh.html);
            return;
          }
          setGone(true);
          setContent(null);
          return;
        }
        setContent(next.html);
      } catch (caught) {
        if (cancelled) return;
        setContentError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [canvasId, detail, projectId, selectedVersion]);

  // The agent updated a canvas. Ours: refresh the detail; on the latest view,
  // the new document follows. A canvas the list does not carry is someone
  // else's and costs one detail read for the picker's freshness only.
  React.useEffect(() => {
    if (!projectId || !visible) return;
    return subscribeOpenchamberEvents((event) => {
      if (event.type !== 'canvas-updated') return;
      if (event.projectId !== projectId) return;
      if (event.canvasId && event.canvasId !== canvasId) return;
      void loadDetail(projectId, canvasId);
      void storeLoad(projectId);
    });
  }, [canvasId, loadDetail, projectId, storeLoad, visible]);

  const versionOptions = detail?.versions ?? [];
  const isLatest = detail !== null && (selectedVersion === null || selectedVersion === detail.version);
  const themeCss = React.useMemo(() => canvasThemeCss(currentTheme), [currentTheme]);
  // The version the shown document belongs to: a fixed selection when the
  // user pinned one, otherwise the detail's latest.
  const shownVersion = isLatest ? detail?.version ?? 0 : selectedVersion ?? 0;

  const handleVersionChange = (value: string) => {
    const parsed = Number(value);
    setSelectedVersion(Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null);
  };

  const handleDelete = async () => {
    if (!projectId || !detail) return;
    if (!window.confirm(t('canvas.list.delete', { title: detail.title }))) return;
    const deleted = await storeDeleteCanvas(detail.id);
    if (deleted) {
      toast.success(t('canvas.toast.deleted'));
      setDetail(null);
      setGone(true);
    } else {
      toast.error(t('canvas.toast.deleteFailed'));
    }
  };

  const handleCopySource = async () => {
    if (!content) return;
    const result = await copyTextToClipboard(content);
    if (result.ok) {
      toast.success(t('canvas.view.copySuccess'));
    } else {
      toast.error(t('canvas.view.copyError'));
    }
  };

  if (loading && !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon name="loader-4" className="size-5 animate-spin text-muted-foreground" />
        <div className="typography-meta text-muted-foreground">{t('canvas.view.loading')}</div>
      </div>
    );
  }

  if (gone) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon name="layout-masonry-fill" className="h-10 w-10 text-muted-foreground/50" />
        <div className="typography-ui-header text-foreground">{t('canvas.view.gone')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="typography-ui-header text-foreground">{t('canvas.view.error', { error })}</div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Select<string>
          value={canvasId}
          onValueChange={(value) => {
            if (!directory) return;
            const target = canvases.find((canvas) => canvas.id === value);
            if (target) openCanvasTab(directory, { id: target.id, title: target.title });
          }}
        >
          <SelectTrigger size="sm" className="min-w-0 max-w-[12rem] flex-1" aria-label={t('canvas.list.title')}>
            <SelectValue>{detail.title}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {canvases.map((canvas) => (
              <SelectItem key={canvas.id} value={canvas.id}>{canvas.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select<string>
          value={String(isLatest ? detail.version : selectedVersion ?? detail.version)}
          onValueChange={handleVersionChange}
        >
          <SelectTrigger size="sm" className="w-auto shrink-0" aria-label={t('canvas.view.versions', { version: detail.version })}>
            <SelectValue>
              {isLatest
                ? t('canvas.view.latest')
                : t('canvas.view.versions', { version: selectedVersion ?? detail.version })}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {versionOptions.map((entry) => (
              <SelectItem key={entry.n} value={String(entry.n)}>
                {t('canvas.view.versions', { version: entry.n })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setView(view === 'rendered' ? 'source' : 'rendered')}
            title={view === 'rendered' ? t('canvas.view.viewSource') : t('canvas.view.viewRendered')}
            aria-label={view === 'rendered' ? t('canvas.view.viewSource') : t('canvas.view.viewRendered')}
            aria-pressed={view === 'source'}
          >
            <Icon name={view === 'rendered' ? 'file-code' : 'eye'} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void handleCopySource()}
            title={t('canvas.view.copy')}
            aria-label={t('canvas.view.copy')}
          >
            <Icon name="file-copy" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void handleDelete()}
            title={t('canvas.list.delete', { title: detail.title })}
            aria-label={t('canvas.list.delete', { title: detail.title })}
          >
            <Icon name="delete-bin" className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {contentLoading && !content ? (
          <div className="flex h-full items-center justify-center">
            <Icon name="loader-4" className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : contentError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="typography-ui-header text-foreground">{t('canvas.view.error', { error: contentError })}</div>
          </div>
        ) : content !== null ? (
          view === 'rendered'
            ? <CanvasDocumentFrame html={content} title={detail.title} themeCss={themeCss} version={shownVersion} />
            : <SourceView html={content} />
        ) : null}
      </div>
    </div>
  );
};
