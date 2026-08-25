# RapidRAW fork maintenance

This repository is a customized fork of `CyberTimon/RapidRAW`. The upstream remote is named
`origin`; the personal fork remote is named `fork`.

The active customized branch is `ui-performance-rotation-v1.6.2`. The last known-good pre-1.6.2
snapshot is preserved as `backup/ui-performance-rotation-v1.5.9` at `e34da599`.

## Non-negotiable fork behavior

Keep these behaviors when updating from upstream. If upstream changes the surrounding architecture,
port the behavior to the new architecture instead of restoring an obsolete file wholesale.

### Personal presentation

- The launch image is `public/personal-splash.jpg`.
- Its credit reads **Images by Tomas Liutvinas** and links to
  `https://www.instagram.com/liutvis/`.
- Upstream release/version information may remain attributed and linked to upstream.

### Library workflow

- Quick image search is available from the customized shortcut/modal.
- Quick comments show a large preview, save on close/Escape, and navigate previous/next images.
- Folder marks and filename ordering remain supported.
- Filename ordering must update active selections, thumbnails, and virtual paths after rename.
- Parent-folder browsing supports both modes:
  - `flat`: images directly inside the selected folder only.
  - `recursive`: images in the selected folder and all descendants.
- The persisted `libraryViewMode` setting controls that choice. Never infer that an empty parent in
  `flat` mode means recursive loading is broken.
- Thumbnail caching remains in the Tauri application cache, not beside source images.

### Editing and performance

- Preserve the custom crop/rotation responsiveness work where it is not superseded upstream.
- Preserve the custom levels controls.
- Prefer upstream's current sharpening implementation when it has replaced the old shader pipeline.
- Keep the Rust `GlobalAdjustments` GPU uniform byte-for-byte aligned with the matching WGSL
  `GlobalAdjustments` struct. A layout mismatch corrupts later fields such as export tile offsets.
- Preserve custom preview, RAW fallback, tooltip, settings-limit, and responsiveness improvements
  when compatible with current upstream APIs.

### SD Card mode

- **Browse SD card safely** opens a selected directory as a session-only library.
- The selected card root is not written to saved `rootFolders`/`lastRootPath` settings.
- The header visibly says **Card mode · read-only**.
- Automatic XMP import, AI indexing, sidecar repair, edits, ratings, labels, tags, comments,
  duplicates, virtual copies, rename/reorder, move, and delete operations must not write below the
  guarded card root.
- Opening or navigating photos in the editor must suppress normal debounced autosave, not merely
  rely on the backend rejection (previewing must not produce error toasts).
- Thumbnail and preview caches may be written only to the application cache.
- Copy/import operations may read from the card and write to a destination outside the card.
- Leaving Card mode clears the backend guard.

The backend path guard is the security boundary. UI hiding or disabled buttons are useful feedback,
but are not a substitute for backend enforcement.

## Packaging on this machine

The development machine runs Arch Linux and launches the repository binary directly through:

`~/.local/share/applications/io.github.CyberTimon.RapidRAW-local.desktop`

The launcher executes:

`src-tauri/target/release/RapidRAW`

Rebuild that binary with:

```bash
npm run tauri build -- --no-bundle
```

The fork's configured package targets are `deb` and `rpm`; AppImage packaging is intentionally
disabled because `linuxdeploy` is not part of this workflow.

## Upstream update procedure

1. Commit and push all current fork work.
2. Create and push a backup branch at the known-good commit.
3. Fetch both remotes:

   ```bash
   git fetch --prune origin
   git fetch --prune fork
   ```

4. Fast-forward the fork's `main` only when `fork/main` has no unique commits.
5. Create a new integration branch from `origin/main`.
6. Replay fork commits in small logical groups. Resolve conflicts against current upstream APIs;
   do not select entire old files merely to make conflicts disappear.
7. Review every item in the test matrix below.
8. Keep the previous customized branch until the integrated build has been used successfully.

## Required verification matrix

### Automated

```bash
npm run build
cd src-tauri && cargo check
cd src-tauri && cargo fmt -- --check
```

The repository-wide TypeScript and ESLint checks may contain upstream failures. Record their exact
output and verify that changed files introduce no new errors; do not label all failures
"pre-existing" without comparing against `origin/main`.

Build the launcher binary after checks pass:

```bash
npm run tauri build -- --no-bundle
```

### Manual smoke tests

- Launch screen uses the personal image and correct attribution.
- Version shown by the app matches `src-tauri/tauri.conf.json`.
- Existing library/session restores.
- Selecting a leaf folder shows its images.
- In `flat` mode, a parent containing only subfolders may be empty.
- In `recursive` mode, selecting that parent shows all descendant images.
- Grid, list, and culling display modes render.
- Search and quick-search select the expected image.
- Quick comments preview, save, close, and navigate correctly.
- Crop, rotation, zoom, levels, and sharpening render and save.
- Export an image larger than the 2048 px GPU tile size and verify that it is a single continuous
  image, without repeated tiles or seams.
- Ratings, tags, labels, rename, move, delete, virtual copies, and filename ordering work in a normal
  library.
- Card mode opens without persisting the card path.
- Card mode previews leaf and recursive folders.
- Card mode rejects edits, comments, metadata changes, rename, move, delete, tagging, virtual copies,
  and filename ordering without creating `.rrdata` or XMP files on the card.
- Card mode can copy/import files to a normal writable destination.
- Returning home and continuing the previous session restores the normal library.

## Future import-new-only design

Build deduplicated card import on top of Card mode rather than as a separate browser. A first pass
should compare stable file facts (size, capture time, camera identifiers, and filename) and confirm
ambiguous matches with a content hash. Store import records outside source folders. Present files as
`new`, `already imported`, or `possible duplicate`, and never mutate the card while scanning.
