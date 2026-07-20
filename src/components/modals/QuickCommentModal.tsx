import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useLibraryActions } from '../../hooks/useLibraryActions';

interface QuickCommentModalProps {
  isOpen: boolean;
  onClose(): void;
}

export default function QuickCommentModal({ isOpen, onClose }: QuickCommentModalProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const libraryActivePath = useLibraryStore((state) => state.libraryActivePath);
  const imageList = useLibraryStore((state) => state.imageList);
  const { handleUpdateExif } = useLibraryActions();
  const [comment, setComment] = useState('');

  const target = useMemo(() => {
    const path = selectedImage?.path || libraryActivePath;
    if (!path) return null;
    const libraryImage = imageList.find((image) => image.path === path);
    return {
      path,
      fileName: path.split(/[\\/]/).pop() || path,
      comment: selectedImage?.exif?.UserComment || libraryImage?.exif?.UserComment || '',
    };
  }, [imageList, libraryActivePath, selectedImage]);

  useEffect(() => {
    if (isOpen) setComment(target?.comment || '');
  }, [isOpen, target?.comment]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!target) return;
    await handleUpdateExif([target.path], { UserComment: comment.trim() });
    onClose();
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-bg-primary/80 px-4 py-3">
          <MessageSquare className="h-5 w-5 text-text-secondary" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-text-primary">{t('modals.quickComment.title')}</h2>
            {target && <p className="truncate text-xs text-text-secondary">{target.fileName}</p>}
          </div>
          <button
            aria-label={t('modals.quickComment.close')}
            className="rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-primary hover:text-text-primary"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <textarea
            autoFocus
            className="min-h-36 w-full resize-y rounded-lg border border-border-color bg-bg-secondary p-3 text-sm text-text-primary outline-hidden focus:border-accent focus:ring-1 focus:ring-accent/30"
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') handleSave();
              if (event.key === 'Escape') onClose();
            }}
            placeholder={t('modals.quickComment.placeholder')}
            value={comment}
          />
        </div>

        <div className="flex items-center justify-between border-t border-bg-primary/80 px-4 py-3 text-xs text-text-secondary">
          <span>{t('modals.quickComment.hint')}</span>
          <div className="flex gap-2">
            <button className="rounded-md px-3 py-1.5 hover:bg-bg-primary" onClick={onClose} type="button">
              {t('modals.quickComment.cancel')}
            </button>
            <button className="rounded-md bg-accent px-3 py-1.5 text-button-text" onClick={handleSave} type="button">
              {t('modals.quickComment.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
