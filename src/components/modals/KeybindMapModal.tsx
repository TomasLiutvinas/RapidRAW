import { Keyboard, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getShortcutLabel, KEYBIND_DEFINITIONS, KEYBIND_SECTIONS } from '../../utils/keyboardUtils';

interface KeybindMapModalProps {
  isOpen: boolean;
  onClose(): void;
}

export default function KeybindMapModal({ isOpen, onClose }: KeybindMapModalProps) {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const osPlatform = useSettingsStore((state) => state.osPlatform);

  if (!isOpen) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 backdrop-blur-xs p-4 pt-[8vh]"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="max-h-[82vh] w-full max-w-4xl overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-bg-primary/80 px-4 py-3">
          <Keyboard className="h-5 w-5 text-text-secondary" />
          <h2 className="flex-1 text-base font-semibold text-text-primary">{t('modals.keybindMap.title')}</h2>
          <button
            aria-label={t('modals.keybindMap.close')}
            className="rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-primary hover:text-text-primary"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 md:grid-cols-2">
          {KEYBIND_SECTIONS.map((section) => {
            const definitions = KEYBIND_DEFINITIONS.filter((definition) => definition.section === section.id);
            return (
              <section className="rounded-lg bg-bg-secondary/50 p-3" key={section.id}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {t(section.label as any)}
                </h3>
                <div className="space-y-1">
                  {definitions.map((definition) => {
                    const shortcut = getShortcutLabel(definition.action, appSettings?.keybinds, osPlatform) || '—';
                    return (
                      <div className="flex items-center justify-between gap-3 py-1" key={definition.action}>
                        <span className="min-w-0 truncate text-sm text-text-primary">{t(definition.description as any)}</span>
                        <kbd className="shrink-0 rounded-md border border-border-color bg-surface px-2 py-1 text-xs text-text-secondary shadow-sm">
                          {shortcut}
                        </kbd>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
