import { FolderMark } from '../components/ui/AppProperties';

export type FolderMarks = Record<string, FolderMark>;

const isValidFolderMark = (value: unknown): value is FolderMark => {
  return value === FolderMark.Raw || value === FolderMark.Exported;
};

export const isSameOrSubPath = (path: string, parentPath: string): boolean => {
  return path === parentPath || path.startsWith(`${parentPath}/`) || path.startsWith(`${parentPath}\\`);
};

export const resolveFolderMark = (path: string | null | undefined, folderMarks?: FolderMarks | null): FolderMark | null => {
  if (!path || !folderMarks) return null;

  return (
    Object.entries(folderMarks)
      .filter(([markedPath, mark]) => isValidFolderMark(mark) && isSameOrSubPath(path, markedPath))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? null
  );
};

export const setFolderMark = (
  folderMarks: FolderMarks | undefined | null,
  path: string,
  mark: FolderMark | null,
): FolderMarks => {
  const next = { ...(folderMarks || {}) };

  if (mark) {
    next[path] = mark;
  } else {
    delete next[path];
  }

  return next;
};

export const removeFolderMarksUnderPath = (
  folderMarks: FolderMarks | undefined | null,
  path: string,
): FolderMarks => {
  return Object.fromEntries(
    Object.entries(folderMarks || {}).filter(([markedPath]) => !isSameOrSubPath(markedPath, path)),
  ) as FolderMarks;
};

export const remapFolderMarksForRename = (
  folderMarks: FolderMarks | undefined | null,
  oldPath: string,
  newPath: string,
): FolderMarks => {
  return Object.fromEntries(
    Object.entries(folderMarks || {}).map(([markedPath, mark]) => [
      isSameOrSubPath(markedPath, oldPath) ? markedPath.replace(oldPath, newPath) : markedPath,
      mark,
    ]),
  ) as FolderMarks;
};
