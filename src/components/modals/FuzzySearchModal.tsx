import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ImageFile } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface FuzzySearchModalProps {
  images: ImageFile[];
  isOpen: boolean;
  onClose(): void;
  onSelect(path: string): void;
  selectedPath?: string | null;
  thumbnails: Record<string, string>;
}

interface SearchResult {
  image: ImageFile;
  title: string;
  fileName: string;
  score: number;
}

const TITLE_EXIF_KEYS = ['ImageDescription', 'ObjectName', 'Title', 'XPTitle', 'DocumentName'];

function getFileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function getNameWithoutExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
}

function getImageTitle(image: ImageFile) {
  const exifTitle = TITLE_EXIF_KEYS.map((key) => image.exif?.[key]?.trim()).find(Boolean);
  return exifTitle || getNameWithoutExtension(getFileName(image.path));
}

function fuzzyScore(query: string, target: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const normalizedTarget = target.toLowerCase();
  let queryIndex = 0;
  let previousMatchIndex = -2;
  let score = normalizedTarget.startsWith(normalizedQuery) ? 60 : 0;

  for (let targetIndex = 0; targetIndex < normalizedTarget.length; targetIndex += 1) {
    if (normalizedTarget[targetIndex] !== normalizedQuery[queryIndex]) continue;

    const isConsecutive = targetIndex === previousMatchIndex + 1;
    const isWordBoundary = targetIndex === 0 || /[\s._\-/\\]/.test(normalizedTarget[targetIndex - 1]);

    score += 12;
    if (isConsecutive) score += 10;
    if (isWordBoundary) score += 8;
    if (previousMatchIndex >= 0 && !isConsecutive) score -= Math.min(targetIndex - previousMatchIndex - 1, 10);

    previousMatchIndex = targetIndex;
    queryIndex += 1;

    if (queryIndex === normalizedQuery.length) {
      return score - normalizedTarget.length * 0.01;
    }
  }

  return null;
}

export default function FuzzySearchModal({
  images,
  isOpen,
  onClose,
  onSelect,
  selectedPath,
  thumbnails,
}: FuzzySearchModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const results = useMemo(() => {
    const trimmedQuery = query.trim();
    const scoredResults = images
      .map((image) => {
        const title = getImageTitle(image);
        const fileName = getFileName(image.path);
        const score = fuzzyScore(trimmedQuery, `${title} ${fileName} ${image.path}`);
        if (score === null) return null;
        return { image, title, fileName, score };
      })
      .filter((result): result is SearchResult => result !== null);

    if (!trimmedQuery) {
      return scoredResults.slice(0, 100);
    }

    return scoredResults.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 100);
  }, [images, query]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedIndex =
      !query.trim() && selectedPath ? results.findIndex((result) => result.image.path === selectedPath) : -1;
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [isOpen, query, results, selectedPath]);

  useEffect(() => {
    resultRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  if (!isOpen) return null;

  const selectResult = (result: SearchResult) => {
    onSelect(result.image.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
    } else if (e.key === 'Enter' && results[highlightedIndex]) {
      e.preventDefault();
      selectResult(results[highlightedIndex]);
    }
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 backdrop-blur-xs pt-[12vh]"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-bg-primary/80 px-4 py-3">
          <Search className="h-5 w-5 text-text-secondary" />
          <input
            aria-label={t('modals.fuzzySearch.searchLabel')}
            className="min-w-0 flex-1 bg-transparent text-lg text-text-primary placeholder:text-text-secondary outline-hidden"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('modals.fuzzySearch.placeholder')}
            ref={inputRef}
            value={query}
          />
          <button
            aria-label={t('modals.fuzzySearch.close')}
            className="rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-primary hover:text-text-primary"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Text variant={TextVariants.body}>{t('modals.fuzzySearch.noResults')}</Text>
            </div>
          ) : (
            results.map((result, index) => {
              const thumbnail = thumbnails[result.image.path];
              const isHighlighted = index === highlightedIndex;
              const isSelected = result.image.path === selectedPath;

              return (
                <button
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    isHighlighted ? 'bg-card-active' : 'hover:bg-bg-primary/70'
                  }`}
                  key={result.image.path}
                  onClick={() => selectResult(result)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  type="button"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-bg-primary">
                    {thumbnail ? (
                      <img alt="" className="h-full w-full object-cover" src={thumbnail} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-text-tertiary">
                        {result.fileName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Text variant={TextVariants.body} className="truncate text-text-primary">
                        {result.title}
                      </Text>
                      {isSelected && (
                        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                          {t('modals.fuzzySearch.current')}
                        </span>
                      )}
                    </div>
                    <Text variant={TextVariants.small} className="truncate text-text-secondary">
                      {result.fileName}
                    </Text>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-bg-primary/80 px-4 py-2 text-xs text-text-secondary">
          <span>{t('modals.fuzzySearch.resultCount', { total: results.length })}</span>
          <span>{t('modals.fuzzySearch.hint')}</span>
        </div>
      </div>
    </div>
  );
}
