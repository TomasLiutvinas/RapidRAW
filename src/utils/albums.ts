import type { Album, AlbumItem } from '../components/ui/AppProperties';

export function findAlbum(items: AlbumItem[], id: string | null): Album | undefined {
  for (const item of items) {
    if (item.type === 'album' && item.id === id) return item;
    if (item.type === 'group') {
      const found = findAlbum(item.children, id);
      if (found) return found;
    }
  }
}
