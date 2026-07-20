import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { ImageFile, Panel, ExifOverlay, Invokes, LibraryViewMode, SortDirection } from '../components/ui/AppProperties';
import { KEYBIND_DEFINITIONS, normalizeCombo } from '../utils/keyboardUtils';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useEditorActions } from './useEditorActions';
import { useLibraryActions } from './useLibraryActions';
import { FILENAME_ORDER_KEY, getParentDir, reorderPathsAsBlock, replacePathPreservingVirtualSuffix } from '../utils/filenameOrder';

interface KeyboardShortcutsProps {
  sortedImageList: Array<ImageFile>;
  handleBackToLibrary(): void;
  handleDeleteSelected(): void;
  handleImageSelect(path: string): void;
  handlePasteFiles(str: string): void;
  handleToggleFullScreen(): void;
  handleZoomChange(zoomValue: number, fitToWindow?: boolean): void;
}

interface ReorderFilesByNameResult {
  renames: Record<string, string>;
  ordered_paths: string[];
}

export const useKeyboardShortcuts = ({
  sortedImageList,
  handleBackToLibrary,
  handleDeleteSelected,
  handleImageSelect,
  handlePasteFiles,
  handleToggleFullScreen,
  handleZoomChange,
}: KeyboardShortcutsProps) => {
  const { handleRotate, handleCopyAdjustments, handlePasteAdjustments } = useEditorActions();
  const { handleRate, handleSetColorLabel, handleToggleTargetAlbumMembership } = useLibraryActions();

  const sortedListRef = useRef(sortedImageList);
  const reorderFlushTimeoutRef = useRef<number | null>(null);
  const reorderInFlightRef = useRef(false);
  const reorderQueuedOrderRef = useRef<string[] | null>(null);
  useEffect(() => {
    sortedListRef.current = sortedImageList;
  }, [sortedImageList]);

  useEffect(() => {
    const getStoreState = () => ({
      editor: useEditorStore.getState(),
      library: useLibraryStore.getState(),
      ui: useUIStore.getState(),
      settings: useSettingsStore.getState(),
      process: useProcessStore.getState(),
    });

    const comboMap = new Map<string, string>();
    const keybinds = useSettingsStore.getState().appSettings?.keybinds;

    for (const def of KEYBIND_DEFINITIONS) {
      const userCombo = keybinds?.[def.action];
      const effective = userCombo && userCombo.length > 0 ? userCombo : def.defaultCombo;
      if (effective) {
        comboMap.set(effective.join('+'), def.action);
      }
    }

    const actions: Record<string, any> = {
      open_image: {
        shouldFire: (s: any) => !s.editor.selectedImage && s.library.libraryActivePath !== null,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleImageSelect(s.library.libraryActivePath!);
        },
      },
      fuzzy_search: {
        shouldFire: (s: ReturnType<typeof getStoreState>) => s.library.imageList.length > 0,
        execute: (e: KeyboardEvent, s: ReturnType<typeof getStoreState>) => {
          e.preventDefault();
          s.ui.setUI({ isFuzzySearchModalOpen: true });
        },
      },
      toggle_target_album: {
        shouldFire: (s: ReturnType<typeof getStoreState>) =>
          !!s.editor.selectedImage || !!s.library.libraryActivePath || s.library.multiSelectedPaths.length > 0,
        execute: (e: KeyboardEvent) => {
          e.preventDefault();
          handleToggleTargetAlbumMembership();
        },
      },
      toggle_comment_overlay: {
        shouldFire: (s: ReturnType<typeof getStoreState>) => !!s.editor.selectedImage || !!s.library.libraryActivePath,
        execute: (e: KeyboardEvent, s: ReturnType<typeof getStoreState>) => {
          e.preventDefault();
          s.ui.setUI({ isCommentOverlayVisible: !s.ui.isCommentOverlayVisible });
        },
      },
      edit_photo_comment: {
        shouldFire: (s: ReturnType<typeof getStoreState>) => !!s.editor.selectedImage || !!s.library.libraryActivePath,
        execute: (e: KeyboardEvent, s: ReturnType<typeof getStoreState>) => {
          e.preventDefault();
          s.ui.setUI({ isQuickCommentModalOpen: true });
        },
      },
      toggle_keybind_map: {
        execute: (e: KeyboardEvent, s: ReturnType<typeof getStoreState>) => {
          e.preventDefault();
          s.ui.setUI({ isKeybindMapOpen: !s.ui.isKeybindMapOpen });
        },
      },
      copy_adjustments: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleCopyAdjustments();
        },
      },
      paste_adjustments: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handlePasteAdjustments();
        },
      },
      copy_files: {
        shouldFire: (s: any) => s.library.multiSelectedPaths.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.process.setProcess({ copiedFilePaths: s.library.multiSelectedPaths });
        },
      },
      paste_files: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handlePasteFiles('copy');
        },
      },
      select_all: {
        shouldFire: () => sortedListRef.current.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.library.setLibrary({ multiSelectedPaths: sortedListRef.current.map((f: ImageFile) => f.path) });
          if (!s.editor.selectedImage) {
            s.library.setLibrary({ libraryActivePath: sortedListRef.current[sortedListRef.current.length - 1].path });
          }
        },
      },
      delete_selected: {
        shouldFire: (s: any) => !s.editor.activeMaskContainerId && !s.editor.activeAiPatchContainerId,
        execute: (e: any) => {
          e.preventDefault();
          handleDeleteSelected();
        },
      },
      preview_prev: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === s.editor.selectedImage!.path);
          if (currentIndex === -1) return;
          let nextIndex = currentIndex - 1 < 0 ? sortedListRef.current.length - 1 : currentIndex - 1;
          handleImageSelect(sortedListRef.current[nextIndex].path);
        },
      },
      preview_next: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === s.editor.selectedImage!.path);
          if (currentIndex === -1) return;
          let nextIndex = currentIndex + 1 >= sortedListRef.current.length ? 0 : currentIndex + 1;
          handleImageSelect(sortedListRef.current[nextIndex].path);
        },
      },
      zoom_in_step: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.min(currentPercent + 0.1, 2.0));
        },
      },
      zoom_out_step: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.max(currentPercent - 0.1, 0.1));
        },
      },
      cycle_zoom: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const { originalSize, displaySize, baseRenderSize } = s.editor;
          const currentPercent =
            originalSize?.width > 0 && displaySize?.width > 0
              ? Math.round(((displaySize.width * dpr) / originalSize.width) * 100)
              : 100;
          let fitPercent = 100;

          if (originalSize?.width > 0 && baseRenderSize?.width > 0) {
            const originalAspect = originalSize.width / originalSize.height;
            const baseAspect = baseRenderSize.width / baseRenderSize.height;
            fitPercent =
              originalAspect > baseAspect
                ? Math.round(((baseRenderSize.width * dpr) / originalSize.width) * 100)
                : Math.round(((baseRenderSize.height * dpr) / originalSize.height) * 100);
          }

          const doubleFitPercent = fitPercent * 2;
          if (Math.abs(currentPercent - fitPercent) < 5) {
            handleZoomChange(doubleFitPercent < 100 ? doubleFitPercent / 100 : 1.0);
          } else if (Math.abs(currentPercent - doubleFitPercent) < 5 && doubleFitPercent < 100) {
            handleZoomChange(1.0);
          } else {
            handleZoomChange(0, true);
          }
        },
      },
      zoom_in: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.min(currentPercent * 1.2, 2.0));
        },
      },
      zoom_out: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.max(currentPercent / 1.2, 0.1));
        },
      },
      zoom_fit: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleZoomChange(0, true);
        },
      },
      zoom_100: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleZoomChange(1.0);
        },
      },
      rotate_left: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleRotate(-90);
        },
      },
      rotate_right: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleRotate(90);
        },
      },
      undo: {
        shouldFire: (s: any) => !!s.editor.selectedImage && s.editor.historyIndex > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.undo();
        },
      },
      redo: {
        shouldFire: (s: any) => !!s.editor.selectedImage && s.editor.historyIndex < s.editor.history.length - 1,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.redo();
        },
      },
      toggle_fullscreen: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleToggleFullScreen();
        },
      },
      show_original: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.setEditor({ showOriginal: !s.editor.showOriginal });
        },
      },
      toggle_adjustments: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Adjustments);
        },
      },
      toggle_crop_panel: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Crop);
        },
      },
      toggle_masks: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Masks);
        },
      },
      toggle_ai: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Ai);
        },
      },
      toggle_presets: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Presets);
        },
      },
      toggle_metadata: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Metadata);
        },
      },
      toggle_analytics: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.setEditor({ isWaveformVisible: !s.editor.isWaveformVisible });
        },
      },
      toggle_export: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Export);
        },
      },
      toggle_library_exif: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const current = s.settings.appSettings?.exifOverlay || ExifOverlay.Off;
          const nextState = {
            [ExifOverlay.Off]: ExifOverlay.Hover,
            [ExifOverlay.Hover]: ExifOverlay.Always,
            [ExifOverlay.Always]: ExifOverlay.Off,
          }[current as ExifOverlay];
          s.settings.handleSettingsChange({ ...s.settings.appSettings, exifOverlay: nextState });
        },
      },
      toggle_crop: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (s.ui.activeRightPanel === Panel.Crop) {
            s.editor.setEditor({ isStraightenActive: !s.editor.isStraightenActive });
          } else {
            s.ui.setRightPanel(Panel.Crop);
            s.editor.setEditor({ isStraightenActive: true });
          }
        },
      },
      rate_0: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(0);
        },
      },
      rate_1: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(1);
        },
      },
      rate_2: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(2);
        },
      },
      rate_3: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(3);
        },
      },
      rate_4: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(4);
        },
      },
      rate_5: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(5);
        },
      },
      color_label_none: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel(null);
        },
      },
      color_label_red: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel('red');
        },
      },
      color_label_yellow: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel('yellow');
        },
      },
      color_label_green: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel('green');
        },
      },
      color_label_blue: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel('blue');
        },
      },
      color_label_purple: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel('purple');
        },
      },
      brush_size_up: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const newSize = Math.min((s.editor.brushSettings.size || 50) + 10, 200);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, size: newSize } });
        },
      },
      brush_size_down: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const newSize = Math.max((s.editor.brushSettings.size || 50) - 10, 1);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, size: newSize } });
        },
      },
    };

    const builtinShortcuts = [
      {
        match: (e: KeyboardEvent) => e.code === 'Escape',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          if (s.editor.isStraightenActive) s.editor.setEditor({ isStraightenActive: false });
          else if (s.ui.customEscapeHandler) s.ui.customEscapeHandler();
          else if (s.editor.activeAiSubMaskId) s.editor.setEditor({ activeAiSubMaskId: null });
          else if (s.editor.activeAiPatchContainerId) s.editor.setEditor({ activeAiPatchContainerId: null });
          else if (s.editor.activeMaskId) s.editor.setEditor({ activeMaskId: null });
          else if (s.editor.activeMaskContainerId) s.editor.setEditor({ activeMaskContainerId: null });
          else if (s.ui.activeRightPanel === Panel.Crop) s.ui.setRightPanel(Panel.Adjustments);
          else if (s.ui.isFullScreen) handleToggleFullScreen();
          else if (s.editor.selectedImage) handleBackToLibrary();
        },
      },
      {
        match: (e: KeyboardEvent, s: any) => {
          const isDeleteKey = s.settings.osPlatform === 'macos' ? e.code === 'Backspace' : e.code === 'Delete';
          return isDeleteKey && (!!s.editor.activeMaskContainerId || !!s.editor.activeAiPatchContainerId);
        },
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          if (s.editor.activeMaskContainerId) {
            s.editor.setEditor((state: any) => ({
              adjustments: {
                ...state.adjustments,
                masks: state.adjustments.masks.filter((c: any) => c.id !== s.editor.activeMaskContainerId),
              },
              activeMaskContainerId: null,
              activeMaskId: null,
            }));
          } else if (s.editor.activeAiPatchContainerId) {
            s.editor.setEditor((state: any) => ({
              adjustments: {
                ...state.adjustments,
                aiPatches: state.adjustments.aiPatches.filter((c: any) => c.id !== s.editor.activeAiPatchContainerId),
              },
              activeAiPatchContainerId: null,
              activeAiSubMaskId: null,
            }));
          }
        },
      },
      {
        match: (e: KeyboardEvent, s: any) =>
          !s.editor.selectedImage && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code),
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const isNext = e.code === 'ArrowRight' || e.code === 'ArrowDown';
          const activePath = s.library.libraryActivePath;
          if (!activePath || sortedListRef.current.length === 0) return;
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === activePath);
          if (currentIndex === -1) return;
          let nextIndex = isNext ? currentIndex + 1 : currentIndex - 1;
          if (nextIndex >= sortedListRef.current.length) nextIndex = 0;
          if (nextIndex < 0) nextIndex = sortedListRef.current.length - 1;
          const nextImage = sortedListRef.current[nextIndex];
          if (nextImage) {
            s.library.setLibrary({ libraryActivePath: nextImage.path, multiSelectedPaths: [nextImage.path] });
          }
        },
      },
    ];

    const mapPathsAfterRename = (renames: Record<string, string>) => {
      const library = useLibraryStore.getState();
      const process = useProcessStore.getState();

      const nextThumbnails: Record<string, string> = {};
      Object.entries(process.thumbnails).forEach(([path, value]) => {
        nextThumbnails[replacePathPreservingVirtualSuffix(path, renames)] = value;
      });

      process.setProcess({ thumbnails: nextThumbnails });
      library.setLibrary((state) => ({
        imageList: state.imageList.map((image) => ({
          ...image,
          path: replacePathPreservingVirtualSuffix(image.path, renames),
        })),
        imageRatings: Object.fromEntries(
          Object.entries(state.imageRatings).map(([path, rating]) => [replacePathPreservingVirtualSuffix(path, renames), rating]),
        ),
        multiSelectedPaths: state.multiSelectedPaths.map((path) => replacePathPreservingVirtualSuffix(path, renames)),
        libraryActivePath: state.libraryActivePath
          ? replacePathPreservingVirtualSuffix(state.libraryActivePath, renames)
          : state.libraryActivePath,
        selectionAnchorPath: state.selectionAnchorPath
          ? replacePathPreservingVirtualSuffix(state.selectionAnchorPath, renames)
          : state.selectionAnchorPath,
      }));

      if (reorderQueuedOrderRef.current) {
        reorderQueuedOrderRef.current = reorderQueuedOrderRef.current.map((path) =>
          replacePathPreservingVirtualSuffix(path, renames),
        );
      }
    };

    const flushReorderQueue = async () => {
      if (reorderInFlightRef.current) return;
      const orderedPaths = reorderQueuedOrderRef.current;
      if (!orderedPaths) return;

      reorderQueuedOrderRef.current = null;
      reorderInFlightRef.current = true;
      useLibraryStore.getState().setLibrary({ filenameOrderPending: true });

      try {
        const result = await invoke<ReorderFilesByNameResult>(Invokes.ReorderFilesByName, { orderedPaths });
        mapPathsAfterRename(result.renames || {});
      } catch (error) {
        toast.error(`Failed to reorder files: ${error}`);
      } finally {
        reorderInFlightRef.current = false;
        if (reorderQueuedOrderRef.current) {
          window.setTimeout(flushReorderQueue, 0);
        } else {
          useLibraryStore.getState().setLibrary({ filenameOrderPending: false });
        }
      }
    };

    const scheduleReorderFlush = (orderedPaths: string[]) => {
      reorderQueuedOrderRef.current = orderedPaths;
      if (reorderFlushTimeoutRef.current) window.clearTimeout(reorderFlushTimeoutRef.current);
      reorderFlushTimeoutRef.current = window.setTimeout(flushReorderQueue, 180);
    };

    const handleOrderModeKey = (event: KeyboardEvent, state: ReturnType<typeof getStoreState>) => {
      if (!state.library.filenameOrderMode) return false;
      if (state.editor.selectedImage || state.ui.activeView !== 'library') return false;

      const orderedPaths = sortedListRef.current.map((image) => image.path);
      if (orderedPaths.length === 0) return false;

      const activePath = state.library.libraryActivePath || orderedPaths[0];
      const activeIndex = Math.max(0, orderedPaths.indexOf(activePath));
      const columnStep = Math.max(1, state.library.libraryColumnCount || 1);
      const setActiveIndex = (index: number) => {
        const nextIndex = Math.max(0, Math.min(orderedPaths.length - 1, index));
        const nextPath = orderedPaths[nextIndex];
        state.library.setLibrary({ libraryActivePath: nextPath, multiSelectedPaths: [nextPath], selectionAnchorPath: nextPath });
      };

      const getVerticalIndex = (direction: 'up' | 'down') => {
        if (columnStep <= 1) return direction === 'down' ? activeIndex + 1 : activeIndex - 1;
        if (direction === 'up') return activeIndex - columnStep;

        const nextRowIndex = activeIndex + columnStep;
        if (nextRowIndex < orderedPaths.length) return nextRowIndex;

        const currentColumn = activeIndex % columnStep;
        const lastRowStart = Math.floor((orderedPaths.length - 1) / columnStep) * columnStep;
        return Math.min(lastRowStart + currentColumn, orderedPaths.length - 1);
      };

      if (['KeyH', 'KeyJ', 'KeyK', 'KeyL'].includes(event.code)) {
        event.preventDefault();
        if (event.code === 'KeyH') setActiveIndex(activeIndex - 1);
        if (event.code === 'KeyL') setActiveIndex(activeIndex + 1);
        if (event.code === 'KeyJ') setActiveIndex(getVerticalIndex('down'));
        if (event.code === 'KeyK') setActiveIndex(getVerticalIndex('up'));
        return true;
      }

      if (!['KeyA', 'KeyS'].includes(event.code)) return false;
      event.preventDefault();

      if (state.library.activeAlbumId) {
        toast.info('Filename order mode is for folders. Album-specific order should not rename files.');
        return true;
      }
      if (state.settings.appSettings?.libraryViewMode === LibraryViewMode.Recursive) {
        toast.info('Switch to Current Folder view before using filename order mode.');
        return true;
      }

      const visiblePathSet = new Set(orderedPaths);
      const selectedPaths = (state.library.multiSelectedPaths.length > 0 ? state.library.multiSelectedPaths : [activePath]).filter(
        (path) => visiblePathSet.has(path),
      );
      if (selectedPaths.length === 0) return true;
      if (selectedPaths.some((path) => path.includes('?vc='))) {
        toast.info('Filename order mode cannot rename virtual copies.');
        return true;
      }

      const selectedDirs = new Set(selectedPaths.map(getParentDir));
      const visibleDirs = new Set(orderedPaths.map(getParentDir));
      if (selectedDirs.size !== 1 || visibleDirs.size !== 1) {
        toast.info('Filename order mode only works within one folder at a time.');
        return true;
      }

      const step = event.shiftKey || event.repeat ? 10 : 1;
      const nextOrder = reorderPathsAsBlock(orderedPaths, selectedPaths, event.code === 'KeyA' ? 'up' : 'down', step);
      const byPath = new Map(state.library.imageList.map((image) => [image.path, image]));
      const reorderedVisibleImages = nextOrder.map((path) => byPath.get(path)).filter(Boolean) as ImageFile[];
      const remainingImages = state.library.imageList.filter((image) => !visiblePathSet.has(image.path));
      state.library.setSortCriteria({ key: FILENAME_ORDER_KEY, order: SortDirection.Ascending });
      state.library.setLibrary({
        imageList: [...reorderedVisibleImages, ...remainingImages],
        libraryActivePath: activePath,
        multiSelectedPaths: selectedPaths,
      });
      scheduleReorderFlush(nextOrder);
      return true;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const state = getStoreState();

      const isInputFocused =
        document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      const normalized = normalizeCombo(event, state.settings.osPlatform);
      const action = comboMap.get(normalized.join('+'));

      if (!isInputFocused && action === 'toggle_keybind_map') {
        actions.toggle_keybind_map.execute(event, state);
        return;
      }

      const isModalOpen =
        state.ui.isCreateFolderModalOpen ||
        state.ui.isRenameFolderModalOpen ||
        state.ui.isRenameFileModalOpen ||
        state.ui.isImportModalOpen ||
        state.ui.isCopyPasteSettingsModalOpen ||
        state.ui.isFuzzySearchModalOpen ||
        state.ui.isQuickCommentModalOpen ||
        state.ui.isKeybindMapOpen ||
        state.ui.confirmModalState.isOpen ||
        state.ui.panoramaModalState.isOpen ||
        state.ui.cullingModalState.isOpen ||
        state.ui.collageModalState.isOpen ||
        state.ui.denoiseModalState.isOpen ||
        state.ui.negativeModalState.isOpen;

      if (isModalOpen) return;

      if (isInputFocused) return;

      if (handleOrderModeKey(event, state)) return;

      for (const builtin of builtinShortcuts) {
        if (builtin.match(event, state)) {
          builtin.execute(event, state);
          return;
        }
      }

      if (action) {
        const handler = actions[action];
        if (handler && (!handler.shouldFire || handler.shouldFire(state))) {
          handler.execute(event, state);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (reorderFlushTimeoutRef.current) {
        window.clearTimeout(reorderFlushTimeoutRef.current);
      }
    };
  }, [
    handleBackToLibrary,
    handleDeleteSelected,
    handleImageSelect,
    handlePasteFiles,
    handleToggleFullScreen,
    handleZoomChange,
    handleRotate,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleRate,
    handleSetColorLabel,
    handleToggleTargetAlbumMembership,
  ]);
};
