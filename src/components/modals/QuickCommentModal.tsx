import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, ChevronRight, MessageSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useLibraryActions } from '../../hooks/useLibraryActions';
import { useSortedLibrary } from '../../hooks/useSortedLibrary';
import { Invokes } from '../ui/AppProperties';

interface QuickCommentModalProps {
  isOpen: boolean;
  onClose(): void;
  onSelectImage(path: string): void;
}

export default function QuickCommentModal({ isOpen, onClose, onSelectImage }: QuickCommentModalProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const selectedImagePath = selectedImage?.path || null;
  const finalPreviewUrl = useEditorStore((state) => state.finalPreviewUrl);
  const libraryActivePath = useLibraryStore((state) => state.libraryActivePath);
  const setLibrary = useLibraryStore((state) => state.setLibrary);
  const imageList = useLibraryStore((state) => state.imageList);
  const thumbnails = useProcessStore((state) => state.thumbnails);
  const { displayList: sortedImageList } = useSortedLibrary();
  const { handleUpdateExif } = useLibraryActions();
  const [comment, setComment] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const isEditorMode = Boolean(selectedImagePath);

  const target = useMemo(() => {
    const path = selectedImagePath || libraryActivePath;
    if (!path) return null;
    const libraryImage = imageList.find((image) => image.path === path);
    return {
      path,
      fileName: path.split(/[\\/]/).pop() || path,
      comment: selectedImage?.exif?.UserComment || libraryImage?.exif?.UserComment || '',
    };
  }, [imageList, libraryActivePath, selectedImage, selectedImagePath]);

  const fallbackImageUrl = target?.path
    ? selectedImagePath === target.path && finalPreviewUrl
      ? finalPreviewUrl
      : thumbnails[target.path]
    : null;
  const displayImageUrl = previewPath === target?.path && previewUrl ? previewUrl : fallbackImageUrl;

  useEffect(() => {
    if (!isOpen || !target?.path) {
      return;
    }

    if (fallbackImageUrl) {
      setPreviewPath(null);
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const timer = window.setTimeout(() => {
      invoke<number[]>(Invokes.GeneratePreviewForPath, { path: target.path, jsAdjustments: {} })
        .then((res) => {
          if (cancelled) return;
          const bytes = Uint8Array.from(res);
          const blob = new Blob([bytes.buffer], { type: 'image/jpeg' });
          objectUrl = URL.createObjectURL(blob);
          setPreviewPath(target.path);
          setPreviewUrl(objectUrl);
        })
        .catch(() => {
          if (!cancelled) setPreviewUrl(null);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallbackImageUrl, isOpen, target?.path]);

  useEffect(() => {
    if (isOpen) setComment(target?.comment || '');
  }, [isOpen, target?.comment]);

  const saveComment = useCallback(
    async (path: string | undefined, value: string) => {
      if (!path) return;
      const nextComment = value.trim();
      const { selectedImage } = useEditorStore.getState();
      const { imageList: currentImageList } = useLibraryStore.getState();
      const currentComment =
        selectedImage?.path === path
          ? selectedImage.exif?.UserComment || ''
          : currentImageList.find((image) => image.path === path)?.exif?.UserComment || '';

      if (currentComment === nextComment) return;
      await handleUpdateExif([path], { UserComment: nextComment });
    },
    [handleUpdateExif],
  );

  const handleClose = useCallback(async () => {
    await saveComment(target?.path, comment);
    onClose();
  }, [comment, onClose, saveComment, target?.path]);

  const navigateBy = useCallback(
    async (delta: -1 | 1) => {
      if (!target?.path || sortedImageList.length === 0) return;
      const currentIndex = sortedImageList.findIndex((image) => image.path === target.path);
      if (currentIndex === -1) return;

      const nextIndex = (currentIndex + delta + sortedImageList.length) % sortedImageList.length;
      const nextPath = sortedImageList[nextIndex]?.path;
      if (!nextPath) return;

      const previousPath = target.path;
      const previousComment = comment;

      if (isEditorMode) {
        onSelectImage(nextPath);
      } else {
        setLibrary({ libraryActivePath: nextPath, multiSelectedPaths: [nextPath], selectionAnchorPath: nextPath });
      }

      void saveComment(previousPath, previousComment);
    },
    [comment, isEditorMode, onSelectImage, saveComment, setLibrary, sortedImageList, target?.path],
  );

  if (!isOpen) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-black p-4 pb-6"
      onClick={handleClose}
      role="dialog"
    >
      {displayImageUrl && (
        <img
          alt={target?.fileName || ''}
          className="absolute inset-0 h-full w-full object-contain"
          src={displayImageUrl}
        />
      )}

      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-white/10"
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
            onClick={handleClose}
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
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') handleClose();
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
                event.preventDefault();
                navigateBy(-1);
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
                event.preventDefault();
                navigateBy(1);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                handleClose();
              }
            }}
            placeholder={t('modals.quickComment.placeholder')}
            value={comment}
          />
        </div>

        <div className="flex items-center justify-between border-t border-bg-primary/80 px-4 py-3 text-xs text-text-secondary">
          <span>{t('modals.quickComment.hint')} · Ctrl+H/L previous/next · Esc saves</span>
          <div className="flex gap-2">
            <button className="rounded-md px-2 py-1.5 hover:bg-bg-primary" onClick={() => navigateBy(-1)} type="button">
              <ChevronLeft size={16} />
            </button>
            <button className="rounded-md px-2 py-1.5 hover:bg-bg-primary" onClick={() => navigateBy(1)} type="button">
              <ChevronRight size={16} />
            </button>
            <button className="rounded-md bg-accent px-3 py-1.5 text-button-text" onClick={handleClose} type="button">
              {t('modals.quickComment.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
