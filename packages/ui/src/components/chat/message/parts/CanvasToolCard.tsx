import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { isVSCodeRuntime } from '@/lib/desktop';
import type { CanvasToolResult } from '@/lib/canvasApi';
import { useUIStore } from '@/stores/useUIStore';

/**
 * The chat card for an `openchamber_canvas` call.
 *
 * A canvas is a thing the user opens in the Canvas panel, so the card names
 * it and opens it; the document itself never renders in chat. While the call
 * runs the card is a live status; a failed call shows the tool's error
 * instead of pretending a canvas exists.
 *
 * VS Code and mobile have no canvas panel, so they keep the title and
 * version without an Open button: the card still says what was built, and
 * does not promise an action that cannot happen there.
 */

type CanvasToolCardProps = {
  directory: string | null;
  result: CanvasToolResult | null;
  running: boolean;
};

export const CanvasToolCard: React.FC<CanvasToolCardProps> = ({ directory, result, running }) => {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const canOpen = !isVSCodeRuntime() && !isMobile && Boolean(directory);

  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--interactive-border)' }}>
        <Icon name="loader-4" className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <span className="typography-meta text-muted-foreground">{t('canvas.card.building')}</span>
      </div>
    );
  }

  const canvas = result?.ok ? result.data : null;
  if (!canvas) {
    const message = result?.error?.message ?? '';
    return (
      <div
        className="rounded-xl border p-2"
        style={{ borderColor: 'var(--status-error-border)', backgroundColor: 'var(--status-error-background)' }}
      >
        <div className="typography-meta font-medium" style={{ color: 'var(--status-error)' }}>
          {t('chat.toolPart.error')}
        </div>
        {message ? <div className="typography-meta mt-0.5" style={{ color: 'var(--status-error)' }}>{message}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--interactive-border)' }}>
      <Icon name="layout-masonry-fill" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate typography-ui-label font-medium text-foreground">{canvas.title}</div>
        <div className="typography-micro text-muted-foreground">
          {canvas.created ? t('canvas.card.created') : t('canvas.card.updated', { version: canvas.version })}
        </div>
      </div>
      {canOpen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            useUIStore.getState().openCanvasTab(directory ?? '', { id: canvas.id, title: canvas.title });
          }}
        >
          <Icon name="arrow-right-up" className="size-3.5" />
          {t('canvas.card.open')}
        </Button>
      ) : null}
    </div>
  );
};
