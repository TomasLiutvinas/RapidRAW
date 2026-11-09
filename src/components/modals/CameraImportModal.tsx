import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { Camera, FolderOpen, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/useUIStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useProcessStore } from '../../store/useProcessStore';
import { AppSettings } from '../ui/AppProperties';
import { Status } from '../ui/ExportImportProperties';
import { formatBytes } from '../../utils/formatBytes';

type Options = NonNullable<AppSettings['cameraImport']>;
type PlannedFile = {
  source: string;
  destination: string;
  kind: 'raw' | 'jpeg' | 'photo' | 'video';
  bytes: number;
  date: string;
  status: 'new' | 'alreadyImported' | 'conflict';
  dateFallback: boolean;
  reason: string | null;
};
type Plan = {
  id: string;
  files: PlannedFile[];
  folders: string[];
  newCount: number;
  alreadyImported: number;
  conflicts: number;
  newBytes: number;
  fallbackDates: number;
};
type Result = { imported: number; alreadyImported: number; conflicts: number; cancelled: boolean; errors: string[] };
type ScanProgress = { current: number; total: number; path: string };

export default function CameraImportModal() {
  const isOpen = useUIStore((s) => s.isCameraImportOpen);
  return isOpen ? <CameraImporter /> : null;
}

function CameraImporter() {
  const { t } = useTranslation();
  const appSettings = useSettingsStore.getState().appSettings;
  const [options, setOptions] = useState<Options>(
    appSettings?.cameraImport ?? {
      sourceRoot: '/mnt/camera',
      destination: '',
      includeRaw: true,
      includeJpeg: true,
      includeVideos: true,
    },
  );
  const [mounted, setMounted] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'importing'>('idle');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const started = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = phase !== 'idle';
  const importProgress = useProcessStore((s) => s.importState.progress);
  const activePath = useProcessStore((s) => s.importState.path);
  const close = () => useUIStore.getState().setUI({ isCameraImportOpen: false });

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const listener = listen<ScanProgress>('camera-import-scan-progress', (event) => setProgress(event.payload));
    return () => {
      void listener.then((unlisten) => unlisten());
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary') ??
          []),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, []);

  const scan = async () => {
    setError('');
    setPlan(null);
    setResult(null);
    setProgress(null);
    setCancelling(false);
    setPhase('scanning');
    try {
      const { appSettings: current, handleSettingsChange } = useSettingsStore.getState();
      if (current) await handleSettingsChange({ ...current, cameraImport: options });
      const status = await invoke<{ mounted: boolean; message: string }>('camera_import_status', {
        sourceRoot: options.sourceRoot,
      });
      setMounted(status.mounted);
      if (!status.mounted) {
        setError(status.message);
        return;
      }
      if (!options.destination) {
        setError(t('cameraImport.chooseDestination'));
        return;
      }
      const nextPlan = await invoke<Plan>('camera_import_scan', { options });
      setPlan(nextPlan);
    } catch (e) {
      setError(String(e));
    } finally {
      setPhase('idle');
    }
  };
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void scan();
    }
  }, []);

  const changeOptions = (next: Partial<Options>) => {
    setOptions((prev) => ({ ...prev, ...next }));
    setPlan(null);
    setResult(null);
    setError('');
  };
  const chooseFolder = async (field: 'sourceRoot' | 'destination') => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: options[field] || undefined,
        title: field === 'sourceRoot' ? t('cameraImport.card') : t('cameraImport.destination'),
      });
      if (typeof path === 'string') {
        changeOptions({ [field]: path });
        if (field === 'sourceRoot') setMounted(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const run = async () => {
    if (!plan?.newCount) return;
    setPhase('importing');
    setError('');
    setCancelling(false);
    try {
      setResult(await invoke<Result>('camera_import_run', { planId: plan.id }));
      setPlan(null);
    } catch (e) {
      setError(String(e));
      useProcessStore.getState().setImportState({ status: Status.Error, errorMessage: String(e) });
    } finally {
      setPhase('idle');
    }
  };
  const cancel = async () => {
    setCancelling(true);
    try {
      await invoke('camera_import_cancel');
    } catch (e) {
      setError(String(e));
      setCancelling(false);
    }
  };
  const days = useMemo(() => {
    const groups = new Map<string, { raw: number; jpeg: number; video: number; existing: number; conflicts: number }>();
    for (const file of plan?.files ?? []) {
      const row = groups.get(file.date) ?? { raw: 0, jpeg: 0, video: 0, existing: 0, conflicts: 0 };
      if (file.status === 'new') row[file.kind === 'photo' ? 'jpeg' : file.kind]++;
      else if (file.status === 'alreadyImported') row.existing++;
      else row.conflicts++;
      groups.set(file.date, row);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [plan]);
  const current = phase === 'scanning' ? progress : importProgress;
  const percent = current?.total ? Math.min(100, Math.round(((current.current ?? 0) / current.total) * 100)) : 0;
  const folder = (field: 'sourceRoot' | 'destination', label: string) => (
    <div className="rounded-lg border border-border-color bg-bg-primary p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-text-secondary">{label}</span>
        <button
          type="button"
          disabled={busy}
          className="text-sm text-text-primary underline underline-offset-4 disabled:opacity-40"
          onClick={() => void chooseFolder(field)}
        >
          {t('cameraImport.change')}
        </button>
      </div>
      <div className="mt-1 break-all text-sm text-text-primary">
        {options[field] || t('cameraImport.chooseDestination')}
      </div>
    </div>
  );
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-import-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!busy) close();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-color bg-surface text-text-primary shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border-color px-5 py-4">
          <Camera className="text-[#ff9e00]" size={22} />
          <h2 id="camera-import-title" className="grow text-lg font-semibold">
            {t('cameraImport.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={t('cameraImport.close')}
            disabled={busy}
            onClick={close}
            className="rounded p-1 hover:bg-bg-primary disabled:opacity-30"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {folder('sourceRoot', t('cameraImport.card'))}
            {folder('destination', t('cameraImport.destination'))}
          </div>
          <p className="text-sm text-text-secondary">
            {t('cameraImport.layout')}{' '}
            <span className="font-mono text-text-primary">{t('cameraImport.folderPattern')}</span>
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(['includeRaw', 'includeJpeg', 'includeVideos'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options[key]}
                  disabled={busy}
                  onChange={(e) => changeOptions({ [key]: e.target.checked })}
                  className="h-4 w-4 accent-[#c12b2a]"
                />
                {t(`cameraImport.${key}`)}
              </label>
            ))}
          </div>
          <p className="text-xs text-text-secondary">{t('cameraImport.copyOnly')}</p>
          {mounted !== null && (
            <p className="text-sm text-text-secondary">
              {mounted ? t('cameraImport.mounted') : t('cameraImport.notMounted')}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-orange-400/30 bg-orange-400/10 p-3 text-sm text-orange-200"
            >
              {error}
            </p>
          )}
          {busy && (
            <div role="status" className="rounded-lg bg-bg-primary p-4">
              <div className="flex items-center gap-2 text-sm">
                <LoaderCircle size={18} className="animate-spin text-[#ff9e00]" />
                {cancelling
                  ? t('cameraImport.stopping')
                  : phase === 'scanning'
                    ? t('cameraImport.scanning')
                    : t('cameraImport.importing')}
                {current?.total ? ` ${current.current} / ${current.total}` : ''}
              </div>
              {phase === 'scanning' && (
                <p className="mt-2 text-xs text-text-secondary">{t('cameraImport.scanNotice')}</p>
              )}
              <div className="mt-3 h-1 overflow-hidden rounded bg-surface">
                <div className="h-full bg-[#ff9e00] transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 truncate text-xs text-text-secondary">
                {phase === 'scanning' ? progress?.path : activePath}
              </p>
            </div>
          )}
          {plan && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  [t('cameraImport.new'), plan.newCount],
                  [t('cameraImport.alreadyImported'), plan.alreadyImported],
                  [t('cameraImport.conflicts'), plan.conflicts],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-lg bg-bg-primary p-3">
                    <div className="text-2xl font-semibold">{count.toLocaleString()}</div>
                    <div className="text-xs text-text-secondary">{label}</div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-text-secondary">
                {t('cameraImport.copySize', { size: formatBytes(plan.newBytes, t) })}
              </p>
              <p className="flex items-start gap-2 text-xs text-text-secondary">
                <FolderOpen size={16} className="shrink-0" />
                {plan.folders.join(' · ') || t('cameraImport.noMedia')}
              </p>
              {days.length > 0 && (
                <div className="max-h-52 overflow-auto rounded-lg border border-border-color">
                  <table className="w-full text-right text-xs">
                    <thead className="sticky top-0 bg-bg-primary text-text-secondary">
                      <tr>
                        {(['date', 'raw', 'jpeg', 'video', 'alreadyImported', 'conflicts'] as const).map((key) => (
                          <th key={key} className="px-3 py-2 first:text-left">
                            {t(`cameraImport.${key}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map(([date, row]) => (
                        <tr key={date} className="border-t border-border-color">
                          <td className="px-3 py-2 text-left font-mono">{date}</td>
                          {[row.raw, row.jpeg, row.video, row.existing, row.conflicts].map((count, i) => (
                            <td key={i} className="px-3 py-2">
                              {count || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.fallbackDates > 0 && (
                <p className="text-xs text-orange-200">
                  {t('cameraImport.fallbackDates', { count: plan.fallbackDates })}
                </p>
              )}
              {plan.conflicts > 0 && (
                <details className="text-xs text-orange-200">
                  <summary className="cursor-pointer">{t('cameraImport.conflictDetail')}</summary>
                  <ul className="mt-2 max-h-32 space-y-2 overflow-auto">
                    {plan.files
                      .filter((f) => f.status === 'conflict')
                      .map((f) => (
                        <li key={f.source} className="break-all">
                          {f.source}
                          <br />
                          {f.destination}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              {plan.newCount === 0 && (
                <p className="text-sm">
                  {plan.files.length ? t('cameraImport.nothingNew') : t('cameraImport.noMedia')}
                </p>
              )}
            </>
          )}
          {result && (
            <div role="status" className="space-y-2 rounded-lg bg-bg-primary p-4">
              <h3 className="font-semibold">
                {result.cancelled ? t('cameraImport.stopped') : t('cameraImport.finished')}
              </h3>
              <p className="text-sm">
                {t('cameraImport.result', {
                  imported: result.imported,
                  skipped: result.alreadyImported,
                  conflicts: result.conflicts,
                  errors: result.errors.length,
                })}
              </p>
              {result.errors.length > 0 && (
                <ul className="max-h-36 space-y-1 overflow-auto text-xs text-orange-200">
                  {result.errors.map((message, i) => (
                    <li key={i}>{message}</li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-text-secondary">{t('cameraImport.videosNotice')}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border-color px-5 py-4">
          <button
            type="button"
            disabled={
              busy ||
              !options.sourceRoot ||
              !options.destination ||
              !(options.includeRaw || options.includeJpeg || options.includeVideos)
            }
            onClick={() => void scan()}
            className="flex items-center gap-2 rounded-md bg-bg-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            <RefreshCw size={16} />
            {t('cameraImport.scan')}
          </button>
          {busy ? (
            <button
              type="button"
              disabled={cancelling}
              onClick={() => void cancel()}
              className="rounded-md border border-border-color px-4 py-2 text-sm disabled:opacity-40"
            >
              {t('cameraImport.stop')}
            </button>
          ) : result ? (
            <button
              type="button"
              onClick={close}
              className="rounded-md bg-[#c12b2a] px-5 py-2 text-sm font-semibold text-white"
            >
              {t('cameraImport.done')}
            </button>
          ) : (
            <button
              type="button"
              disabled={!plan?.newCount}
              onClick={() => void run()}
              className="rounded-md bg-[#c12b2a] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t('cameraImport.importNew', { count: plan?.newCount ?? 0 })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
