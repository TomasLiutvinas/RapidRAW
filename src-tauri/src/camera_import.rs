//! Copy-only camera ingestion, separate from the photo renderer (videos are archived, not edited).
use crate::{
    file_management::ensure_card_writable,
    formats::{is_raw_file, is_supported_image_file},
};
use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::SystemTime,
};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "m4v", "avi", "mts", "m2ts", "mxf", "mpg", "mpeg", "3gp", "mkv",
];
static PLANS: LazyLock<Mutex<HashMap<String, ImportPlan>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static BUSY: AtomicBool = AtomicBool::new(false);
static CANCELLED: AtomicBool = AtomicBool::new(false);
struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}
fn begin() -> Result<BusyGuard, String> {
    BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "A camera scan or import is already running.".to_string())?;
    CANCELLED.store(false, Ordering::SeqCst);
    Ok(BusyGuard)
}
fn check_cancelled() -> Result<(), String> {
    if CANCELLED.load(Ordering::SeqCst) {
        Err("Camera import cancelled.".into())
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CameraImportOptions {
    pub source_root: String,
    pub destination: String,
    pub include_raw: bool,
    pub include_jpeg: bool,
    pub include_videos: bool,
}
impl Default for CameraImportOptions {
    fn default() -> Self {
        Self {
            source_root: "/mnt/camera".into(),
            destination: PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Pictures/Camera")
                .to_string_lossy()
                .into_owned(),
            include_raw: true,
            include_jpeg: true,
            include_videos: true,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraStatus {
    pub mounted: bool,
    pub message: String,
}

// Linux's mount table distinguishes an empty /mnt/camera directory from an inserted card.
#[cfg(target_os = "linux")]
fn mount_identity(root: &Path) -> Option<String> {
    let root = fs::canonicalize(root).ok()?;
    fs::read_to_string("/proc/self/mountinfo")
        .ok()?
        .lines()
        .filter_map(|line| {
            let field = line.split_whitespace().nth(4)?;
            let mount = PathBuf::from(
                field
                    .replace("\\040", " ")
                    .replace("\\011", "\t")
                    .replace("\\012", "\n")
                    .replace("\\134", "\\"),
            );
            if mount == Path::new("/") || root != mount {
                return None;
            }
            Some((mount.as_os_str().len(), line.to_owned()))
        })
        .max_by_key(|(length, _)| *length)
        .map(|(_, line)| line)
}
#[cfg(not(target_os = "linux"))]
fn mount_identity(root: &Path) -> Option<String> {
    root.is_dir().then(|| root.to_string_lossy().into_owned())
}
fn mounted(root: &Path) -> bool {
    mount_identity(root).is_some()
}

#[tauri::command]
pub fn camera_import_status(source_root: String) -> CameraStatus {
    let ok = mounted(Path::new(&source_root));
    CameraStatus {
        mounted: ok,
        message: if ok {
            "Camera card is mounted.".into()
        } else {
            format!("No camera card mounted at {source_root}. Mount the card, then check again.")
        },
    }
}
fn media_kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some("video")
    } else if is_raw_file(path) {
        Some("raw")
    } else if ["jpg", "jpeg"].contains(&ext.as_str()) {
        Some("jpeg")
    } else if is_supported_image_file(path) {
        Some("photo")
    } else {
        None
    }
}
fn selected(path: &Path, options: &CameraImportOptions) -> bool {
    matches!(media_kind(path), Some("raw") if options.include_raw)
        || matches!(media_kind(path), Some("jpeg" | "photo") if options.include_jpeg)
        || matches!(media_kind(path), Some("video") if options.include_videos)
}
fn walk_media(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for item in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
    {
        check_cancelled()?;
        let item = item.map_err(|e| e.to_string())?;
        if item.file_type().is_file() && media_kind(item.path()).is_some() {
            paths.push(item.into_path());
        }
    }
    paths.sort();
    Ok(paths)
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Stamp {
    len: u64,
    modified: SystemTime,
    identity: String,
}
fn stamp(path: &Path) -> Result<Stamp, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("Not a regular media file: {}", path.display()));
    }
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.ctime(),
            meta.ctime_nsec()
        )
    };
    #[cfg(not(unix))]
    let identity = format!("{:?}", meta.created().ok());
    Ok(Stamp {
        identity,
        len: meta.len(),
        modified: meta.modified().map_err(|e| e.to_string())?,
    })
}
fn hash(path: &Path) -> Result<String, String> {
    let mut reader = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        check_cancelled()?;
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}
fn cached_hash(
    path: &Path,
    hashes: &mut HashMap<PathBuf, (Stamp, String)>,
) -> Result<String, String> {
    let current = stamp(path)?;
    if let Some((saved, digest)) = hashes.get(path)
        && *saved == current
    {
        return Ok(digest.clone());
    }
    let digest = hash(path)?;
    if stamp(path)? != current {
        return Err(format!("File changed during scan: {}", path.display()));
    }
    hashes.insert(path.to_owned(), (current, digest.clone()));
    Ok(digest)
}
fn video_date(path: &Path) -> Option<DateTime<Utc>> {
    // ffprobe reads container metadata without decoding video. It is optional; fallback is visible in the preview.
    let mut child = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format_tags=creation_time:stream_tags=creation_time",
            "-of",
            "json",
        ])
        .arg(path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if check_cancelled().is_err() || std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(30)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let result = child.wait_with_output().ok()?;
    if !result.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&result.stdout).ok()?;
    let value = json
        .pointer("/format/tags/creation_time")
        .and_then(|v| v.as_str())
        .or_else(|| {
            json["streams"]
                .as_array()?
                .iter()
                .find_map(|s| s.pointer("/tags/creation_time").and_then(|v| v.as_str()))
        })?;
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|v| v.with_timezone(&Utc))
}
fn capture_date(path: &Path, file_stamp: &Stamp) -> (DateTime<Local>, bool) {
    let embedded = if media_kind(path) == Some("video") {
        video_date(path)
    } else {
        crate::exif_processing::try_get_embedded_creation_date(path)
    };
    let fallback = embedded.is_none();
    (
        embedded
            .unwrap_or_else(|| DateTime::<Utc>::from(file_stamp.modified))
            .with_timezone(&Local),
        fallback,
    )
}
#[derive(Clone, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
enum FileStatus {
    New,
    AlreadyImported,
    Conflict,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlannedFile {
    source: PathBuf,
    destination: PathBuf,
    kind: String,
    bytes: u64,
    date: String,
    status: FileStatus,
    date_fallback: bool,
    reason: Option<String>,
    #[serde(skip)]
    source_stamp: Stamp,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    #[serde(skip)]
    source_mount: Option<String>,
    id: String,
    options: CameraImportOptions,
    files: Vec<PlannedFile>,
    folders: Vec<String>,
    new_count: usize,
    already_imported: usize,
    conflicts: usize,
    new_bytes: u64,
    fallback_dates: usize,
}
fn destination_root(path: &Path) -> Result<PathBuf, String> {
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Destination cannot contain '..'.".into());
    }
    if !path.is_absolute() {
        return Err("Choose an absolute destination folder.".into());
    }
    let mut ancestor = path;
    let mut missing = Vec::new();
    while !ancestor.exists() {
        missing.push(
            ancestor
                .file_name()
                .ok_or("Invalid destination folder")?
                .to_owned(),
        );
        ancestor = ancestor.parent().ok_or("Invalid destination folder")?;
    }
    let mut resolved = fs::canonicalize(ancestor).map_err(|e| e.to_string())?;
    for name in missing.into_iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}
fn check_destination(source: &Path, destination: &Path) -> Result<(), String> {
    let destination = destination_root(destination)?;
    if destination.starts_with(source) || source.starts_with(&destination) {
        return Err("Choose a destination outside the camera card and its parent folders.".into());
    }
    ensure_card_writable(&destination)
}
fn build_plan(
    options: CameraImportOptions,
    progress: impl FnMut(usize, usize, &Path),
    hashes: &mut HashMap<PathBuf, (Stamp, String)>,
) -> Result<ImportPlan, String> {
    let source = fs::canonicalize(&options.source_root).map_err(|e| e.to_string())?;
    let destination = destination_root(Path::new(&options.destination))?;
    check_destination(&source, &destination)?;
    let source_files: Vec<_> = walk_media(&source)?
        .into_iter()
        .filter(|p| selected(p, &options))
        .collect();
    plan_files(options, source, destination, source_files, progress, hashes)
}

fn plan_files(
    options: CameraImportOptions,
    source: PathBuf,
    destination: PathBuf,
    source_files: Vec<PathBuf>,
    mut progress: impl FnMut(usize, usize, &Path),
    hashes: &mut HashMap<PathBuf, (Stamp, String)>,
) -> Result<ImportPlan, String> {
    let source_mount = mount_identity(&source);
    // Size is a cheap candidate filter. SHA-256 confirms identity even after renames or moves.
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    if destination.exists() {
        for path in walk_media(&destination)? {
            by_size.entry(stamp(&path)?.len).or_default().push(path);
        }
    }
    let mut targets: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut files = Vec::new();
    let mut folders = std::collections::BTreeSet::new();
    for (index, path) in source_files.iter().enumerate() {
        check_cancelled()?;
        progress(index, source_files.len(), path);
        let file_stamp = stamp(path)?;
        let (date, date_fallback) = capture_date(path, &file_stamp);
        let target = destination
            .join(date.format("%Y/%Y-%m-%d").to_string())
            .join(path.file_name().ok_or("Missing filename")?);
        folders.insert(
            path.parent()
                .unwrap()
                .strip_prefix(&source)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        );
        let mut status = FileStatus::New;
        let mut reason = None;
        if let Some(candidates) = by_size.get(&file_stamp.len) {
            let source_hash = cached_hash(path, hashes)?;
            for candidate in candidates {
                if cached_hash(candidate, hashes)? == source_hash {
                    status = FileStatus::AlreadyImported;
                    reason = Some(candidate.to_string_lossy().into_owned());
                    break;
                }
            }
        }
        if status == FileStatus::New {
            if target.exists() || targets.contains_key(&target) {
                status = FileStatus::Conflict;
                reason = Some(
                    "Same destination filename, different contents. Existing file will be kept."
                        .into(),
                );
            } else {
                targets.insert(target.clone(), path.clone());
                by_size
                    .entry(file_stamp.len)
                    .or_default()
                    .push(path.clone());
            }
        }
        files.push(PlannedFile {
            source: path.clone(),
            destination: target,
            kind: media_kind(path).unwrap().into(),
            bytes: file_stamp.len,
            date: date.format("%Y-%m-%d").to_string(),
            status,
            date_fallback,
            reason,
            source_stamp: file_stamp,
        });
    }
    if mount_identity(&source) != source_mount {
        return Err("Camera mount changed during the scan. Scan the card again.".into());
    }
    Ok(ImportPlan {
        source_mount,
        id: uuid::Uuid::new_v4().to_string(),
        options,
        folders: folders.into_iter().collect(),
        new_count: files.iter().filter(|f| f.status == FileStatus::New).count(),
        already_imported: files
            .iter()
            .filter(|f| f.status == FileStatus::AlreadyImported)
            .count(),
        conflicts: files
            .iter()
            .filter(|f| f.status == FileStatus::Conflict)
            .count(),
        new_bytes: files
            .iter()
            .filter(|f| f.status == FileStatus::New)
            .map(|f| f.bytes)
            .sum(),
        fallback_dates: files.iter().filter(|f| f.date_fallback).count(),
        files,
    })
}
#[tauri::command]
pub async fn camera_import_scan(
    options: CameraImportOptions,
    app_handle: AppHandle,
) -> Result<ImportPlan, String> {
    let busy = begin()?;
    if !mounted(Path::new(&options.source_root)) {
        return Err(format!(
            "No camera card mounted at {}.",
            options.source_root
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        let cache_path = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("camera-import-hashes.json");
        let mut hashes = fs::read(&cache_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let outcome = build_plan(
            options,
            |current, total, path| {
                if current % 10 == 0 {
                    let _ = app_handle.emit(
                        "camera-import-scan-progress",
                        serde_json::json!({"current":current,"total":total,"path":path}),
                    );
                }
            },
            &mut hashes,
        );
        hashes.retain(|path, _| path.is_file());
        if let Ok(bytes) = serde_json::to_vec(&hashes) {
            if let Some(parent) = cache_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = crate::file_management::write_file_atomic(&cache_path, &bytes);
        }
        let plan = outcome?;
        let mut plans = PLANS.lock().map_err(|e| e.to_string())?;
        plans.clear();
        plans.insert(plan.id.clone(), plan.clone());
        Ok(plan)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    imported: usize,
    already_imported: usize,
    conflicts: usize,
    cancelled: bool,
    errors: Vec<String>,
}
fn copy_one(file: &PlannedFile, source_root: &Path, destination: &Path) -> Result<bool, String> {
    check_cancelled()?;
    let source = fs::canonicalize(&file.source).map_err(|e| e.to_string())?;
    if !source.starts_with(source_root) || stamp(&source)? != file.source_stamp {
        return Err(format!(
            "Source changed; scan again: {}",
            file.source.display()
        ));
    }
    check_destination(source_root, destination)?;
    let parent = file.destination.parent().ok_or("Invalid target")?;
    let resolved_parent = destination_root(parent)?;
    if !resolved_parent.starts_with(destination) {
        return Err("Destination folder points outside the selected library.".into());
    }
    ensure_card_writable(&resolved_parent)?;
    fs::create_dir_all(&resolved_parent).map_err(|e| e.to_string())?;
    let target = resolved_parent.join(
        file.destination
            .file_name()
            .ok_or("Invalid target filename")?,
    );
    if target.exists() {
        return if stamp(&target)?.len == file.bytes && hash(&target)? == hash(&source)? {
            Ok(false)
        } else {
            Err(format!("Destination already exists: {}", target.display()))
        };
    }
    let mut input = fs::File::open(&source).map_err(|e| e.to_string())?;
    let mut temp = tempfile::Builder::new()
        .prefix(".rapidraw-import-")
        .tempfile_in(&resolved_parent)
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0; 1024 * 1024];
    let mut copied = 0;
    loop {
        check_cancelled()?;
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        temp.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        copied += n as u64;
    }
    if copied != file.bytes || stamp(&source)? != file.source_stamp {
        return Err("Source changed while copying; incomplete copy discarded.".into());
    }
    filetime::set_file_mtime(
        temp.path(),
        filetime::FileTime::from_system_time(file.source_stamp.modified),
    )
    .map_err(|e| e.to_string())?;
    crate::file_management::sync_file(temp.as_file()).map_err(|e| e.to_string())?;
    check_cancelled()?;
    temp.persist_noclobber(&target)
        .map_err(|e| format!("Could not save {}: {}", target.display(), e.error))?;
    Ok(true)
}
#[tauri::command]
pub async fn camera_import_run(
    plan_id: String,
    app_handle: AppHandle,
) -> Result<ImportResult, String> {
    let busy = begin()?;
    let plan = PLANS
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&plan_id)
        .ok_or("This preview has expired. Scan the card again.")?;
    if !mounted(Path::new(&plan.options.source_root)) {
        return Err("Camera card is no longer mounted.".into());
    }
    if mount_identity(Path::new(&plan.options.source_root)) != plan.source_mount {
        return Err("Camera mount changed. Scan the card again.".into());
    }
    let source = fs::canonicalize(&plan.options.source_root).map_err(|e| e.to_string())?;
    let destination = destination_root(Path::new(&plan.options.destination))?;
    check_destination(&source, &destination)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = busy;
        let mut result = ImportResult {
            already_imported: plan.already_imported,
            conflicts: plan.conflicts,
            ..Default::default()
        };
        let _ = app_handle.emit("import-start", serde_json::json!({"total":plan.new_count}));
        for (index, file) in plan
            .files
            .iter()
            .filter(|f| f.status == FileStatus::New)
            .enumerate()
        {
            if check_cancelled().is_err() {
                result.cancelled = true;
                break;
            }
            let _ = app_handle.emit(
                "import-progress",
                serde_json::json!({"current":index,"total":plan.new_count,"path":file.source}),
            );
            if mount_identity(&source) != plan.source_mount {
                result
                    .errors
                    .push("Camera card was unmounted or replaced. Scan it again.".into());
                break;
            }
            match copy_one(file, &source, &destination) {
                Ok(true) => result.imported += 1,
                Ok(false) => result.already_imported += 1,
                Err(error) => {
                    if check_cancelled().is_err() {
                        result.cancelled = true;
                        break;
                    }
                    result
                        .errors
                        .push(format!("{}: {error}", file.source.display()));
                }
            }
        }
        let _ = app_handle.emit("import-complete", &result);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn camera_import_cancel() {
    CANCELLED.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    fn options(source: &Path, destination: &Path) -> CameraImportOptions {
        CameraImportOptions {
            source_root: source.to_string_lossy().into_owned(),
            destination: destination.to_string_lossy().into_owned(),
            ..Default::default()
        }
    }
    fn media(root: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        filetime::set_file_mtime(&path, filetime::FileTime::from_unix_time(1737288000, 0)).unwrap();
        path
    }
    fn scan(options: CameraImportOptions) -> ImportPlan {
        build_plan(options, |_, _, _| {}, &mut HashMap::new()).unwrap()
    }

    #[test]
    fn recursively_discovers_media_preserves_layout_and_respects_choices() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let card = fixture.path().join("card");
        let library = fixture.path().join("library");
        media(&card, "DCIM/100CANON/IMG_0001.CR3", b"raw");
        media(&card, "DCIM/101CANON/IMG_0001.JPG", b"jpeg");
        media(&card, "DCIM/101CANON/MVI_0001.MP4", b"video");
        media(&card, "DCIM/101CANON/settings.dat", b"ignore");
        media(&card, ".hidden/photo.jpg", b"ignore");
        let plan = scan(options(&card, &library));
        assert_eq!(plan.new_count, 3);
        assert_eq!(plan.folders, ["DCIM/100CANON", "DCIM/101CANON"]);
        assert_eq!(plan.fallback_dates, 3);
        for file in &plan.files {
            assert_eq!(file.source.file_name(), file.destination.file_name());
            assert_eq!(
                file.destination.parent().unwrap().file_name().unwrap(),
                file.date.as_str()
            );
            assert!(file.destination.starts_with(&library));
        }
        let mut only_video = options(&card, &library);
        only_video.include_raw = false;
        only_video.include_jpeg = false;
        let filtered = scan(only_video);
        assert_eq!(filtered.new_count, 1);
        assert_eq!(filtered.files[0].kind, "video");
        assert!(!library.exists());
    }
    #[test]
    fn confirms_duplicates_by_contents_even_after_rename_and_move() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let card = fixture.path().join("card");
        let library = fixture.path().join("library");
        media(&card, "DCIM/100CANON/a.jpg", b"same");
        media(&library, "2020/renamed.jpg", b"same");
        media(&card, "DCIM/100CANON/b.jpg", b"new!"); // Same size, different contents is new.
        let plan = scan(options(&card, &library));
        assert_eq!(plan.already_imported, 1);
        assert_eq!(plan.new_count, 1);
        let new_file = plan
            .files
            .iter()
            .find(|f| f.status == FileStatus::New)
            .unwrap();
        fs::create_dir_all(new_file.destination.parent().unwrap()).unwrap();
        fs::write(&new_file.destination, b"keep this existing photo").unwrap();
        let conflict = scan(options(&card, &library));
        assert_eq!(conflict.conflicts, 1);
        assert_eq!(conflict.already_imported, 1);
        assert_eq!(
            fs::read(&new_file.destination).unwrap(),
            b"keep this existing photo"
        );
    }
    #[test]
    fn handles_repeated_card_filenames_and_identical_files_in_one_batch() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let card = fixture.path().join("card");
        let library = fixture.path().join("library");
        media(&card, "DCIM/100CANON/a.jpg", b"first");
        media(&card, "DCIM/101CANON/a.jpg", b"other");
        media(&card, "DCIM/102CANON/copy.jpg", b"first");
        let plan = scan(options(&card, &library));
        assert_eq!(plan.new_count, 1);
        assert_eq!(plan.conflicts, 1);
        assert_eq!(plan.already_imported, 1);
    }
    #[test]
    fn copies_media_without_overwriting_and_rescan_imports_nothing() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let card = fixture.path().join("card");
        let library = fixture.path().join("library");
        let source = media(&card, "DCIM/MVI_0001.MP4", b"original video bytes");
        let plan = scan(options(&card, &library));
        let file = &plan.files[0];
        assert!(copy_one(file, &card, &library).unwrap());
        assert_eq!(
            fs::read(&file.destination).unwrap(),
            b"original video bytes"
        );
        assert_eq!(fs::read(&source).unwrap(), b"original video bytes");
        assert!(!copy_one(file, &card, &library).unwrap());
        let repeated = scan(options(&card, &library));
        assert_eq!(repeated.new_count, 0);
        assert_eq!(repeated.already_imported, 1);
        fs::write(&file.destination, b"existing different video").unwrap();
        assert!(copy_one(file, &card, &library).is_err());
        assert_eq!(
            fs::read(&file.destination).unwrap(),
            b"existing different video"
        );
    }
    #[test]
    fn changed_sources_cancellation_and_unsafe_destinations_do_not_write() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let card = fixture.path().join("card");
        let library = fixture.path().join("library");
        let source = media(&card, "DCIM/a.jpg", b"before");
        let plan = scan(options(&card, &library));
        assert!(check_destination(&card, &card.join("imported")).is_err());
        assert!(destination_root(&library.join("../card")).is_err());
        fs::write(&source, b"after source changed").unwrap();
        assert!(copy_one(&plan.files[0], &card, &library).is_err());
        assert!(!library.exists());
        CANCELLED.store(true, Ordering::SeqCst);
        assert!(build_plan(options(&card, &library), |_, _, _| {}, &mut HashMap::new()).is_err());
        assert!(!library.exists());
    }
    #[cfg(unix)]
    #[test]
    fn destination_symlink_cannot_redirect_a_copy_onto_the_card() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let card = fixture.path().join("card");
        let library = fixture.path().join("library");
        media(&card, "DCIM/a.jpg", b"photo");
        let plan = scan(options(&card, &library));
        let target = &plan.files[0].destination;
        fs::create_dir_all(target.parent().unwrap().parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&card, target.parent().unwrap()).unwrap();
        assert!(copy_one(&plan.files[0], &card, &library).is_err());
        assert!(!card.join("a.jpg").exists());
    }
    #[test]
    fn hash_cache_invalidates_when_file_changes() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let file = media(fixture.path(), "a.jpg", b"first");
        let mut hashes = HashMap::new();
        let before = cached_hash(&file, &mut hashes).unwrap();
        fs::write(&file, b"other").unwrap();
        assert_ne!(before, cached_hash(&file, &mut hashes).unwrap());
        let saved = serde_json::to_vec(&hashes).unwrap();
        let mut restored = serde_json::from_slice(&saved).unwrap();
        assert_eq!(
            cached_hash(&file, &mut hashes).unwrap(),
            cached_hash(&file, &mut restored).unwrap()
        );
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn ordinary_directory_is_not_reported_as_a_mounted_card() {
        let fixture = tempfile::tempdir().unwrap();
        assert!(!mounted(fixture.path()));
    }
    #[test]
    #[ignore = "Read-only integration scan of a locally mounted card; never copies media"]
    fn preview_real_camera_without_copying() {
        let _lock = TEST_LOCK.lock().unwrap();
        let _busy = begin().unwrap();
        let source =
            std::env::var("RAPIDRAW_CAMERA_SOURCE").unwrap_or_else(|_| "/mnt/camera".into());
        let destination = std::env::var("RAPIDRAW_CAMERA_DESTINATION")
            .expect("Set the archive path for the read-only preview");
        assert!(mounted(Path::new(&source)));
        let cache_path = Path::new("/tmp/rapidraw-camera-test-hashes.json");
        let mut hashes = fs::read(cache_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let source_root = fs::canonicalize(&source).unwrap();
        let all_media = walk_media(&source_root).unwrap();
        eprintln!(
            "Discovered {} media files across the full card",
            all_media.len()
        );
        let mut sample = std::collections::BTreeSet::new();
        let mut seen = std::collections::HashSet::new();
        for path in &all_media {
            let key = (path.parent().unwrap().to_owned(), media_kind(path).unwrap());
            if seen.insert(key) {
                sample.insert(path.clone());
            }
        }
        let plan = plan_files(
            options(Path::new(&source), Path::new(&destination)),
            source_root,
            destination_root(Path::new(&destination)).unwrap(),
            sample.into_iter().collect(),
            |current, total, path| {
                eprintln!("Scanned {current}/{total}: {}", path.display());
            },
            &mut hashes,
        )
        .unwrap();
        fs::write(cache_path, serde_json::to_vec(&hashes).unwrap()).unwrap();
        fs::write(
            "/tmp/rapidraw-camera-real-plan.json",
            serde_json::to_vec_pretty(&plan).unwrap(),
        )
        .unwrap();
        eprintln!(
            "{} new, {} already imported, {} conflicts, {} fallback dates",
            plan.new_count, plan.already_imported, plan.conflicts, plan.fallback_dates
        );
        assert!(plan.files.iter().any(|f| f.kind == "video"));
    }
}
