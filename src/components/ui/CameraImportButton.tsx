import { Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/useUIStore';

export default function CameraImportButton({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const label = t('cameraImport.title');
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center justify-center gap-2 rounded-md bg-[#c12b2a] text-white font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9e00] ${compact ? 'h-10 w-10' : 'h-11 w-full px-4'}`}
      onClick={() => useUIStore.getState().setUI({ isCameraImportOpen: true })}
      title={label}
      aria-label={label}
      data-tooltip={compact ? label : undefined}
    >
      <Camera size={18} />
      {!compact && label}
    </button>
  );
}
