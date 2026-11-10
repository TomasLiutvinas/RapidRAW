# RapidRAW fork maintenance

This repository is a customized fork of `CyberTimon/RapidRAW`. The upstream remote is named
`origin`; the personal fork remote is named `fork`.

The active customized branch is `main`, integrated with upstream `aa419508` on 2026-11-10
(version 1.6.9 plus the natural filename sorting fix). The integration branch is
`integrate-upstream-2026-11-09`; the pre-update fork is preserved and pushed as
`backup/pre-upstream-2026-11-09` at `877e779b`.
The previous 1.6.6 integration remains at `integrate-upstream-2026-10-20`, with its
pre-update backup at `backup/pre-upstream-2026-10-20` (`8fa33237`).
The earlier 1.6.4 integration is retained as `integrate-upstream-2026-10-04`, with its
pre-update backup at `backup/pre-upstream-fixes-2026-10-04` (`edc535bc`).
The previous customized branch is `ui-performance-rotation-v1.6.2`. The last known-good pre-1.6.2
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
- Crop dragging previews locally and commits on release; resize targets must take priority over
  outside-crop rotation. Keep image-under-frame panning and accessible handles at every zoom level.
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
npm run build:local
```

Do not replace this with `cargo build --release`: plain Cargo does not apply Tauri's production
configuration and produces a binary that tries to load `http://localhost:1420`.

The release profile favors local rebuild speed: full release optimization (`opt-level = 3`),
16 code-generation units, incremental compilation, and no link-time optimization. Compared with
the upstream single-unit, whole-program LTO profile, this trades some potential runtime optimization
for faster compilation. Incremental caches consume additional space under `src-tauri/target`;
keep that directory between builds. Changing profiles triggers a one-time dependency rebuild.

`build:local` skips installers and keeps the binary at the launcher's existing path. The equivalent
command is `npm run tauri build -- --no-bundle`.

The fork's configured package targets are `deb` and `rpm`; AppImage packaging is intentionally
disabled because `linuxdeploy` is not part of this workflow.

## Upstream update procedure

1. Commit and push all current fork work.
2. Create and push a backup branch at the known-good commit.
3. Fetch both remotes:

   ```bash
   git fetch --prune origin
   git fetch --prune --no-prune-tags fork
   ```

4. Fast-forward the fork's `main` only when `fork/main` has no unique commits.
5. Create a new integration branch from the current customized branch and merge `origin/main`
   with `--no-commit --no-ff`, preserving both histories.
6. Resolve and audit overlaps in small logical groups against current upstream APIs; do not select
   entire old files merely to make conflicts disappear.
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
npm run build:local
```

### Manual smoke tests

- Launch screen uses the personal image and correct attribution.
- Version shown by the app matches `src-tauri/tauri.conf.json`.
- Existing library restores.
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
- Returning home and choosing Open Library restores the saved folders and browsing location.

## 2026-10-04 upstream integration

The full upstream history was merged on an integration branch, preserving fork commit history.
Conflicts were resolved by keeping upstream's current editing architecture and adapting fork
levels, quick comments/search, folder marks, filename ordering, shortcuts, and crop rotation.
The faster local release profile and personal splash remain. Upstream sharpening supersedes
the old fork radius/detail controls; Rust and WGSL GPU uniform layouts match upstream exactly.

The new shared rating/label/flag metadata writer validates all paths against Card mode before
writing. Sidecar cleanup is also guarded, including a cleanup request above the guarded root.
Backend regression tests cover metadata validation, cleanup, copy-out, and unrated-filter
serialization. Startup now respects the saved flat/recursive mode even when a flat folder is empty.

Verification includes frontend/release builds, Rust check/format, browser smoke tests with mocked
IPC for merged controls and workflows, and a real 3072×1536 GPU export checked for tile continuity.
The integrated TypeScript diagnostics match upstream's 70 existing errors. Lint diagnostics were
compared with both upstream and the prior fork using the updated lint configuration/dependencies.
Native GUI testing with an actual RAW library and SD card remains a manual follow-up.

## 2026-10-20 upstream integration

Merged upstream `454789b7`, retaining the complete fork history. Upstream's current GPU
pipeline, shared adjustment defaults, Kelvin white balance, finer curve dragging, tool
visibility, auto-straighten, effects, and file-mapping fixes are combined with the fork's
levels, color palettes, personal splash, quick search/comments, folder marks, filename
ordering, crop rotation, and faster local release profile. GPU uniform and shader files
match upstream; levels continue to render through the existing curves representation.

The audit found shortcut definitions whose handlers had already disappeared in the previous
integration. Quick comments (`N`), comment overlays (`C`), the shortcut map (`Shift+/`), and
target-album membership (`Q`) now work again. Comment badges use the selected library photo
even when another photo remains cached in the editor. The comment modal owns Escape and
saves before closing; the shortcut map closes without navigating away from the photo.

Card protection now covers upstream's shared sidecar writer, including deletion of
default-only sidecars, XMP synchronization, auto lens correction, and legacy EXIF cache
migration. Browsing a card does not overwrite saved folder state. Cancelling the normal
folder picker retains Card mode; opening a normal folder restores normal roots rather than
saving the card root. Returning home flushes pending work before releasing the card guard
and clears the card's editor state.

Validation:

- Frontend production build, Rust compiler check, Rust formatting, and launcher release build.
- Backend regression tests cover guarded metadata/default-sidecar deletion, legacy EXIF
  preservation, cleanup (including above the guarded root), copy-out, and unrated settings.
- Browser smoke tests with mocked IPC verify personal credit/version, card session isolation,
  suppressed card autosave and normal autosave, quick search, comment save/navigation/Escape,
  shortcut-map dismissal, target-album add/remove, levels dragging, color presets, Kelvin
  mode, and crop rotation commit/drag cleanup.
- A real 3072×1536, 16-bit TIFF export through the RTX 3090 Vulkan GPU passes tile continuity
  checks (mean adjacent-pixel change at x=2048: 0.68 on an 8-bit inspection; separate distant
  gradient samples confirm tiles do not repeat).
- TypeScript diagnostics match current upstream's 67 errors by file and diagnostic code.
  ESLint and runtime translation diagnostics are compared against upstream and the previous
  fork; no new lint errors beyond those baselines and identical 207 translation issues.

Browser IPC checks do not replace native testing with the user's actual RAW library, SD card,
and export presets. Those remain manual smoke checks; source libraries were not modified.
The previous launcher binary is also saved at `/tmp/RapidRAW-pre-upstream-20261020` for the
current machine session; the pushed backup branch is the durable rollback point.

## 2026-11-10 upstream integration

Merged upstream `aa419508` (1.6.9 plus natural filename sorting), retaining the complete fork
history and the personal splash, quick search/comments, shortcut map, target-album shortcuts,
folder marks, filename ordering, levels, color palettes, Card mode, packaging, and local release
profile. Upstream's new GPU, lens correction, editor, crop, Immich, and metadata architecture is
retained. GPU processing, image processing, and shader files match upstream exactly.

Adapted Card protection to the new atomic sidecar updates and shared generated-output writers.
Reading a corrupt sidecar does not quarantine it on a card; reading bloated EXIF does not rewrite
it. Batch processing, XMP sync, and shared output writers retain backend write guards. The local
copy stage is shared by the async copy command and its regression test. Quick search now reads
the editor selection and thumbnails explicitly after upstream removed the old subscriptions.
Context-menu album removal keeps upstream's Immich handler alongside the fork's local shortcut.
Outside-crop rotation hit areas now follow the viewport crop wrapper through zoom and pan.

Validation:

- Frontend production build, Rust compiler check, Rust formatting, and final Tauri launcher build.
- Both backend regression tests pass, covering guarded metadata and atomic/generated writes,
  corrupt/bloated sidecar preservation, legacy EXIF, cleanup above the card root, copy-out, and
  unrated-filter serialization.
- Browser checks with synthetic photos and mocked Tauri IPC verify personal credit/version,
  quick-search filtering, comment save-on-Escape, shortcut-map dismissal, target-album add/remove,
  Card mode header/session isolation, suppressed card autosave and normal autosave, levels-handle
  dragging, color preset selection, and an actual pointer drag committing crop rotation.
- A real 3072×1536 16-bit TIFF export on the RTX 3090 Vulkan GPU passes continuity checks:
  mean adjacent-pixel change at x=2048 is 0.345 on an 8-bit inspection; distant gradient samples
  differ as expected. The export used temporary configuration/cache/data directories under `/tmp`.
- TypeScript diagnostics match upstream's 63 errors by file and diagnostic code. ESLint adds no
  errors over upstream; two existing fork literal-string warnings remain. Exact check logs for
  this session are under `/tmp/rapidraw-*.log`, including the upstream comparison logs.
- Runtime translations validate 1890 plural resolutions and 31892 placeholder sets across 17 locales.

The launcher binary is rebuilt at its existing path. Its previous version is saved at
`/tmp/RapidRAW-pre-upstream-20261109`; the pushed backup branch is the durable rollback point.
Native GUI testing with the user's actual RAW library, physical SD card, and saved export presets
remains manual. Browser mocks and the synthetic GPU export do not exercise those real inputs.

## Camera import

**Import from camera** is available on the welcome screen and as a red camera button in the
library toolbar. Opening it checks the saved card mount (initially `/mnt/camera`) and scans all
media folders recursively. A plain, unmounted directory is not treated as an inserted card on Linux.
The destination initially defaults to `~/Pictures/Camera`; both paths and RAW/JPEG/video choices
are remembered in `cameraImport` application settings. All three media categories default on.

The normal procedure is: mount the card, click **Import from camera**, review the preview, and click
**Import N new files**. No per-folder file selection or repeated template entry is required.
The fixed layout is `YYYY/YYYY-MM-DD/original filename`, based on embedded capture time. Photos
read embedded EXIF/RAW metadata without migrating sidecars. Videos use container creation time
through `ffprobe` when available; missing metadata falls back to file modification time and is
explicitly counted in the preview. Videos are archived alongside photos; they are not displayed or
edited in RapidRAW's photo grid. Non-media camera/system files are ignored.

Deduplication indexes existing media throughout the selected destination library. File size narrows
candidates; SHA-256 confirms identical contents even after a rename or a move within that library.
Fingerprints are cached in the application data directory, keyed by path, size, modification time,
and file identity. Changed files invalidate cached checks. Completed checks are saved even when a
scan is stopped. The first scan of a large, previously imported card can take a while because it
must read matching file contents. Subsequent scans reuse unchanged fingerprints.

The preview separates new files, already imported files, and conflicting destination names. Only
new files are copied. A name collision with different contents is skipped and shown for review;
existing media and edits are never overwritten. Repeated names and duplicate contents within a
single card are handled before copying. Copies use temporary destination files, preserve source
modification times, sync to disk, and publish without replacing an existing path. Interrupted copies
are discarded. Mount changes and changed source files invalidate the preview or stop the copy.
Destination symlinks are checked before writing. The importer has no delete-from-card operation.

Validation on 2026-11-10:

- Production frontend and Tauri launcher builds, Rust formatting/compiler checks, and the full
  backend suite (10 passing tests; optional real-card test excluded from ordinary runs).
- Tests cover recursive RAW/JPEG/video discovery, remembered-layout destinations, content-based
  deduplication after renames/moves, same-size nonduplicates, filename conflicts, repeated source
  names, repeat imports, changed sources, cancellation, hash-cache invalidation/serialization,
  unmounted directories, and symlink destinations pointing back onto the card.
- Browser checks with mocked IPC cover both entry points, saved preferences, missing-card handling,
  preview counts, submission by preview ID, completion, scan Stop, and disabled controls while busy.
  New components pass ESLint; TypeScript diagnostics match the prior 63-error baseline.
- Real-card read-only discovery found 2937 RAW files, 2937 JPEGs, and 26 MP4s in
  `DCIM/100CANON` and `DCIM/101CANON`. A representative RAW/JPEG/video from each folder was
  checked against the real archive: 3 new, 3 already imported, no conflicts, and no fallback dates.
  A full byte-check pass was stopped to avoid unnecessarily rereading the entire card during testing.
  No card media was imported. The representative preview is at `/tmp/rapidraw-camera-real-plan.json`.

The pre-feature launcher binary is saved at `/tmp/RapidRAW-pre-camera-import-20261110` for this
machine session. Future upstream updates must retain this copy-only workflow and its safeguards.

## Editing sets

An editing set is an ordinary saved album of references to existing photos. In Folders, select a
range or individual photos, right-click, and choose **Create editing set from selection…**. Naming
it creates the album with that selection, makes it the target, expands Albums, and opens the album.
Existing albums can be chosen with **Use as editing set** in their context menu. The target is
remembered in the `targetAlbumId` application setting; it is cleared when the album is deleted.

The target album row displays the configured **Q** membership shortcut instead of a generic target
symbol, alongside its photo count. It is also shown in an **Adding to: Album · count** bar while
browsing folders. The badge is clickable, highlights when the selected photos are already members,
and briefly reacts to additions/removals. All selected members are removed; otherwise missing
photos are added. The current photo is used in the editor. Custom bindings and disabled bindings
are reflected in the badge. **Shift+Q** still removes photos from the currently viewed album.

Membership changes capture the photos selected at the time of each keypress and serialize their
album writes. Creating an editing set uses the same queue. Removing the current editor photo from
the active album advances to another remaining photo, or returns to the library if the album empties.
No source images are moved or copied to form an album, and edits remain attached to each photo.

**Export album…** is available on the album context menu and the target bar. The export panel labels
which album is being exported and uses all of its photos, independently of the current selection
or filters. **Use selected photos instead** returns to ordinary selection export. Focusing the export
panel must preserve explicit album export; opening an ordinary export action clears that mode.

Validation: production frontend/Rust builds and the existing backend suite; TypeScript diagnostics
match the prior 63-error baseline, with no new ESLint diagnostics. Browser tests with synthetic
photos and mocked IPC cover creation from a multi-selection, automatic targeting/opening, Q add/remove,
Alt+Q remapping, disabled bindings, queued keypresses retaining their captured selections, preference
restoration after reload, and a complete album export request while only one photo is selected.
Real library photos and album files were not changed during testing.

## Crop interaction

Crop mode uses a local draft, painted at most once per animation frame. Pointer moves run the
existing rotated-image constraints without updating the editor component tree, preview pipeline,
or saved adjustments. Release commits the accepted draft, including a final move before the next
paint; cancellation restores the starting crop without a saved edit. Keyboard nudges also commit
the accepted draft rather than potentially stale ReactCrop props. Pixel conversion tolerates
floating-point roundoff so unchanged integer coordinates do not creep between repeated edits.

Dragging inside the crop moves the photo beneath a stationary frame. Crop boundaries remain inside
the source photograph, including at fine rotation angles. The frame offset follows viewport zoom
and is accounted for when leaving crop mode while zoomed. Straighten and guided perspective retain
their independent preview and drawing overlays.

Corner and midpoint targets are 32 CSS pixels (44 on coarse pointers), with 18-pixel edge strips.
Their size does not shrink when zooming. Corners have visible white L-shaped marks; locked aspect
ratios support edge grabs too. A 28-pixel image-fit margin keeps full-image handles accessible.
Resize controls sit above outside rotation targets, so their outer halves cannot start a rotation.
Dragging farther outside rotates, with a distinct cursor; cancelling rotation restores its start.
Alt-drag resizes about the crop centre, retaining the existing Ctrl/Command option. Crop controls
become hidden and stop intercepting input when leaving the tool.

Validation on 2026-11-10: production frontend and Tauri launcher builds; 19 browser checks against
the actual Editor/ImageCanvas using a synthetic grid image and mocked IPC. Checks cover all four
outer-half corner grabs, live/saved state separation, stationary-frame panning, image bounds,
Alt-centred resizing, aspect locks, cancellation of resize and pan, keyboard nudges, outside rotation,
constant handle size at 2× zoom, hidden controls, source-point preservation on zoomed crop exit,
locked-ratio edge resizing, rotated-image bounds, and straighten/perspective preview routing.
TypeScript retains its existing 63 diagnostics and ESLint its existing 854 findings; no new
diagnostics by file/rule, and the new component passes ESLint. No real media or sidecars were edited.
The previous launcher is backed up at `/tmp/RapidRAW-pre-crop-20261110` for this machine session.
