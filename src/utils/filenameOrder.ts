export const FILENAME_ORDER_KEY = 'manual_order';
export const FILENAME_ORDER_PREFIX_REGEX = /^RR_\d{8}__(.+)$/;

export const stripFilenameOrderPrefix = (fileName: string): string => {
  return fileName.match(FILENAME_ORDER_PREFIX_REGEX)?.[1] || fileName;
};

export const getParentDir = (filePath: string): string => {
  const physicalPath = filePath.split('?vc=')[0];
  const separator = physicalPath.includes('/') ? '/' : '\\';
  const index = physicalPath.lastIndexOf(separator);
  return index === -1 ? '' : physicalPath.substring(0, index);
};

export const replacePathPreservingVirtualSuffix = (path: string, renames: Record<string, string>): string => {
  const [physicalPath, virtualSuffix] = path.split('?vc=');
  const renamed = renames[physicalPath] || renames[path];
  if (!renamed) return path;
  return virtualSuffix ? `${renamed}?vc=${virtualSuffix}` : renamed;
};

export const reorderPathsAsBlock = (
  orderedPaths: string[],
  selectedPaths: string[],
  direction: 'up' | 'down',
  step: number,
): string[] => {
  const selected = new Set(selectedPaths);
  const block = orderedPaths.filter((path) => selected.has(path));
  if (block.length === 0) return orderedPaths;

  const firstIndex = orderedPaths.findIndex((path) => selected.has(path));
  const remaining = orderedPaths.filter((path) => !selected.has(path));
  const insertIndex =
    direction === 'up' ? Math.max(0, firstIndex - step) : Math.min(remaining.length, firstIndex + step);

  return [...remaining.slice(0, insertIndex), ...block, ...remaining.slice(insertIndex)];
};
