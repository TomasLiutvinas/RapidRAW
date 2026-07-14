import { motion } from 'framer-motion';
import {
  SlidersHorizontal,
  Info,
  Crop,
  Layers,
  Paintbrush,
  SwatchBook,
  FileInput,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Panel } from '../../ui/AppProperties';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { appendShortcutToTooltip, getShortcutLabel } from '../../../utils/keyboardUtils';

interface PanelOptions {
  icon: LucideIcon;
  id: Panel;
  shortcutAction?: string;
  title: string;
}

interface RightPanelSwitcherProps {
  activePanel: Panel | null;
  onPanelSelect(id: Panel): void;
  isInstantTransition: boolean;
  layout?: 'horizontal' | 'vertical';
}

const panelGroups: Array<Array<PanelOptions>> = [
  [{ id: Panel.Metadata, icon: Info, shortcutAction: 'toggle_metadata', title: 'editor.switcher.tooltips.info' }],
  [
    {
      id: Panel.Adjustments,
      icon: SlidersHorizontal,
      shortcutAction: 'toggle_adjustments',
      title: 'editor.switcher.tooltips.adjust',
    },
    { id: Panel.Crop, icon: Crop, shortcutAction: 'toggle_crop_panel', title: 'editor.switcher.tooltips.crop' },
    { id: Panel.Masks, icon: Layers, shortcutAction: 'toggle_masks', title: 'editor.switcher.tooltips.masks' },
    { id: Panel.Ai, icon: Paintbrush, shortcutAction: 'toggle_ai', title: 'editor.switcher.tooltips.inpaint' },
  ],
  [
    {
      id: Panel.Presets,
      icon: SwatchBook,
      shortcutAction: 'toggle_presets',
      title: 'editor.switcher.tooltips.presets',
    },
    { id: Panel.Export, icon: FileInput, shortcutAction: 'toggle_export', title: 'editor.switcher.tooltips.export' },
  ],
];

export default function RightPanelSwitcher({
  activePanel,
  onPanelSelect,
  isInstantTransition,
  layout = 'vertical',
}: RightPanelSwitcherProps) {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((s) => s.appSettings);
  const osPlatform = useSettingsStore((s) => s.osPlatform);
  const isHorizontal = layout === 'horizontal';

  return (
    <div className={isHorizontal ? 'flex items-center overflow-x-auto p-1 gap-1' : 'flex flex-col p-1 gap-1 h-full'}>
      {panelGroups.map((group, groupIndex) => (
        <div key={groupIndex} className={isHorizontal ? 'flex items-center gap-1' : 'flex flex-col gap-1'}>
          {groupIndex > 0 && (
            <div
              className={isHorizontal ? 'w-px h-6 bg-surface self-stretch my-auto' : 'w-6 h-px bg-surface self-center'}
            />
          )}
          {group.map(({ id, icon: Icon, shortcutAction, title }) => {
            const shortcut = shortcutAction
              ? getShortcutLabel(shortcutAction, appSettings?.keybinds, osPlatform)
              : null;
            return (
              <button
                className={`relative rounded-md transition-colors duration-200 ${isHorizontal ? 'p-2 shrink-0' : 'p-2'} ${
                  activePanel === id
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
                key={id}
                onClick={() => onPanelSelect(id)}
                data-tooltip={appendShortcutToTooltip(t(title), shortcut)}
              >
                {activePanel === id && (
                  <motion.div
                    layoutId="active-panel-indicator"
                    className="absolute inset-0 bg-surface rounded-md"
                    transition={isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <Icon size={20} className="relative z-10" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
