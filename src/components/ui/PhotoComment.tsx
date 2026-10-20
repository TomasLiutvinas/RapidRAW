import { MessageSquare, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';

export function PhotoCommentBadge({ path, comment, className }: { path: string; comment?: string; className: string }) {
  const visible = useUIStore((state) => state.isCommentOverlayVisible);
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <button
      type="button"
      className={className}
      data-tooltip={t('editor.comments.editTooltip')}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        useLibraryStore
          .getState()
          .setLibrary({ libraryActivePath: path, multiSelectedPaths: [path], selectionAnchorPath: path });
        useUIStore.getState().setUI({ isQuickCommentModalOpen: true });
      }}
    >
      <span className="flex items-start gap-1.5">
        <MessageSquare size={12} className="mt-0.5 shrink-0" />
        <span className="line-clamp-3 text-[10px] leading-tight">{comment?.trim() || t('editor.comments.empty')}</span>
      </span>
    </button>
  );
}

export function PhotoCommentOverlay({ comment }: { comment?: string }) {
  const visible = useUIStore((state) => state.isCommentOverlayVisible);
  const setUI = useUIStore((state) => state.setUI);
  const { t } = useTranslation();
  return (
    <div className="absolute left-4 bottom-4 z-20 flex max-w-[min(36rem,calc(100%-2rem))] items-end gap-2 pointer-events-none">
      <button
        className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-color bg-surface/90 shadow-lg backdrop-blur-md"
        data-tooltip={t('editor.comments.toggleTooltip')}
        onClick={(event) => {
          event.stopPropagation();
          setUI({ isCommentOverlayVisible: !visible });
        }}
        type="button"
      >
        <MessageSquare size={16} className={visible ? 'text-accent' : 'text-text-secondary'} />
      </button>
      {visible && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border-color bg-surface/90 px-3 py-2 text-sm text-text-primary shadow-xl backdrop-blur-md">
          <p className="line-clamp-4 min-w-0 whitespace-pre-wrap">{comment?.trim() || t('editor.comments.empty')}</p>
          <button
            className="shrink-0 rounded-md p-1 text-text-secondary hover:text-text-primary"
            data-tooltip={t('editor.comments.editTooltip')}
            onClick={(event) => {
              event.stopPropagation();
              setUI({ isQuickCommentModalOpen: true });
            }}
            type="button"
          >
            <Pencil size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
