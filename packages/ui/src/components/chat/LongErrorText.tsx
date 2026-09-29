import React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getLongErrorPreview } from './longErrorPreview';

interface LongErrorTextProps {
  text: string;
  /** Renders the visible part of the error: the preview while collapsed, the full text once expanded. */
  children: (visibleText: string) => React.ReactNode;
  buttonClassName?: string;
}

/**
 * Shows a long error collapsed to its first lines with a button to reveal the
 * rest. Short errors render unchanged. The full text is never rendered while
 * collapsed, so a huge error costs nothing until someone asks to read it.
 */
export const LongErrorText: React.FC<LongErrorTextProps> = ({ text, children, buttonClassName }) => {
  const { t } = useI18n();
  // Remember which error was expanded, so a different error arriving in the
  // same place starts collapsed again.
  const [expandedText, setExpandedText] = React.useState<string | null>(null);
  const expanded = expandedText === text;
  const preview = React.useMemo(() => getLongErrorPreview(text), [text]);

  if (preview === null) return <>{children(text)}</>;

  return (
    <>
      {/* The full text scrolls inside its own box, so "Show less" stays right under it. */}
      {expanded ? <div className="max-h-96 overflow-y-auto">{children(text)}</div> : children(preview)}
      <Button
        variant="link"
        size="xs"
        aria-expanded={expanded}
        onClick={() => setExpandedText(expanded ? null : text)}
        className={cn('-ml-2 normal-case', buttonClassName)}
      >
        {expanded ? t('chat.longError.collapse') : t('chat.longError.expand')}
      </Button>
    </>
  );
};
