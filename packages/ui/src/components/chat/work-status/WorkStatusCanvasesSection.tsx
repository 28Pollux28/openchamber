import React from 'react';
import { getCurrentIntlLocale, useI18n } from '@/lib/i18n';
import { Icon } from '@/components/icon/Icon';
import { createProjectIdFromPath } from '@/lib/projectId';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { useCanvasStore } from '@/stores/useCanvasStore';
import { useUIStore } from '@/stores/useUIStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useProjectContextOwner } from '@/hooks/useProjectContextOwner';
import { WorkStatusCollapsibleSection, WorkStatusRow } from './WorkStatusPrimitives';
import { useReportWorkStatusPresence } from './presenceContext';

type Props = {
  directory: string | null;
};

/**
 * The canvases the agent built in this project, like the MCP list: one row
 * per canvas, opening the Canvas viewer in the context panel.
 *
 * The list belongs to the project, not the session — a canvas outlives the
 * chat that produced it — so the directory resolves through the same owner
 * hook the project panel and agent memory use, and a worktree session sees
 * the project's canvases. Updates arrive as `canvas-updated` events; the
 * section re-reads while it is mounted and reports presence so an empty
 * project collapses the section away, like every other data-driven section.
 */
export const WorkStatusCanvasesSection: React.FC<Props> = ({ directory }) => {
  const { t } = useI18n();
  const owner = useProjectContextOwner(directory);
  const projectId = React.useMemo(
    () => (owner ? createProjectIdFromPath(owner.path) : null),
    [owner],
  );

  const canvases = useCanvasStore((state) => state.canvases);
  const load = useCanvasStore((state) => state.load);
  const refresh = useCanvasStore((state) => state.refresh);

  // The MCP rule, carried over: `isConnected` is a dependency, not a gate —
  // the list is cached by project id, two instances can hold the same path,
  // and the connection itself has to trigger the ask.
  const isConnected = useConfigStore((state) => state.isConnected);
  React.useEffect(() => {
    void load(projectId);
  }, [isConnected, load, projectId]);

  React.useEffect(() => {
    if (!projectId) return;
    return subscribeOpenchamberEvents((event) => {
      if (event.type !== 'canvas-updated') return;
      if (event.projectId !== projectId) return;
      void refresh();
    });
  }, [projectId, refresh]);

  useReportWorkStatusPresence('canvases', canvases.length > 0);

  if (canvases.length === 0) return null;

  return (
    <WorkStatusCollapsibleSection
      id="canvases"
      title={t('chat.workStatus.section.canvases')}
      iconNode={<Icon name="layout-masonry-fill" className="size-4 shrink-0 text-muted-foreground" />}
      summary={String(canvases.length)}
    >
      {canvases.map((canvas) => (
        <WorkStatusRow
          key={canvas.id}
          label={canvas.title}
          onClick={() => {
            if (!directory) return;
            useUIStore.getState().openCanvasTab(directory, { id: canvas.id, title: canvas.title });
          }}
          value={(
            <span className="typography-micro text-muted-foreground">
              {new Date(canvas.updatedAt).toLocaleDateString(getCurrentIntlLocale())}
            </span>
          )}
        />
      ))}
    </WorkStatusCollapsibleSection>
  );
};
