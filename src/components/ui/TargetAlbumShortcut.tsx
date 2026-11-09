import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryActions } from '../../hooks/useLibraryActions';
import { getShortcutLabel } from '../../utils/keyboardUtils';
import type { Album } from './AppProperties';

export default function TargetAlbumShortcut({ album }: { album: Album }) {
  const { t } = useTranslation();
  const { selected, active, feedback } = useLibraryStore(
    useShallow((s) => ({
      selected: s.multiSelectedPaths,
      active: s.libraryActivePath,
      feedback: s.targetAlbumFeedback,
    })),
  );
  const image = useEditorStore((s) => s.selectedImage);
  const activeView = useUIStore((s) => s.activeView);
  const { appSettings, osPlatform } = useSettingsStore(
    useShallow((s) => ({ appSettings: s.appSettings, osPlatform: s.osPlatform })),
  );
  const { handleToggleTargetAlbumMembership } = useLibraryActions();
  const paths = activeView === 'editor' && image ? [image.path] : selected.length ? selected : active ? [active] : [];
  const removing = paths.length > 0 && paths.every((path) => album.images.includes(path));
  const shortcut = getShortcutLabel('toggle_target_album', appSettings?.keybinds, osPlatform);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (feedback?.albumId !== album.id) return;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 500);
    return () => clearTimeout(timer);
  }, [feedback?.token, album.id]);
  const label = t(removing ? 'editingSets.removeShortcut' : 'editingSets.addShortcut', {
    name: album.name,
    shortcut: shortcut ?? t('editingSets.noShortcut'),
  });
  return (
    <button
      type="button"
      disabled={!paths.length}
      aria-label={label}
      aria-pressed={removing}
      data-tooltip={label}
      onClick={(event) => {
        event.stopPropagation();
        void handleToggleTargetAlbumMembership();
      }}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-4 transition-all disabled:opacity-70 ${removing || pulse ? 'border-[#ff9e00]/60 bg-[#ff9e00]/10 text-[#ffb84d]' : 'border-[#ff9e00]/40 bg-bg-primary text-[#ffb84d]'} ${pulse ? 'scale-110' : ''}`}
    >
      <kbd className="whitespace-nowrap font-mono">{shortcut ?? t('editingSets.noShortcut')}</kbd>
    </button>
  );
}
