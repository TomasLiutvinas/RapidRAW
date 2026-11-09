import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { findAlbum } from '../../../utils/albums';
import TargetAlbumShortcut from '../../ui/TargetAlbumShortcut';

export default function EditingSetBar({ onOpen }: { onOpen(id: string, name: string, paths: string[]): void }) {
  const { t } = useTranslation();
  const { tree, target, feedback } = useLibraryStore(
    useShallow((s) => ({ tree: s.albumTree, target: s.targetAlbumId, feedback: s.targetAlbumFeedback })),
  );
  const { handleExportAlbum } = useLibraryActions();
  const album = findAlbum(tree, target);
  if (!album) return null;
  return (
    <div className="mx-3 mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-color bg-surface px-3 py-2 text-xs">
      <span className="text-text-secondary">{t('editingSets.addingTo')}</span>
      <button
        type="button"
        className="min-w-0 max-w-[45%] truncate font-semibold text-text-primary hover:underline"
        onClick={() => onOpen(album.id, album.name, album.images)}
      >
        {album.name} · {album.images.length}
      </button>
      <TargetAlbumShortcut album={album} />
      <span role="status" aria-live="polite" className="text-text-secondary">
        {feedback?.albumId === album.id
          ? t(feedback.action === 'added' ? 'editingSets.added' : 'editingSets.removed')
          : ''}
      </span>
      <button
        type="button"
        disabled={!album.images.length}
        onClick={() => handleExportAlbum(album.id)}
        className="ml-auto shrink-0 text-text-primary underline underline-offset-2 disabled:opacity-40"
      >
        {t('editingSets.exportAlbum')}
      </button>
    </div>
  );
}
