use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const VIDEO: &[&str] = &["mp4", "m4v", "mov", "webm", "ogv"];
const AUDIO: &[&str] = &["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"];
const BACKGROUND_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];
const MAX_BACKGROUND_SIZE: usize = 10 * 1024 * 1024;
const BIBLES: &[(&str, &str, &str)] = &[
    (
        "WEBP",
        "World English Bible",
        include_str!("../../public/bible-WEBP.json"),
    ),
    (
        "WEBPB",
        "World English Bible (British)",
        include_str!("../../public/bible-WEBPB.json"),
    ),
];

type CommandResult<T> = Result<T, String>;

pub struct Library {
    db: Mutex<Connection>,
    picks: Mutex<Picks>,
}

#[derive(Default)]
struct Picks {
    folders: HashSet<PathBuf>,
    files: HashSet<PathBuf>,
}

#[derive(Deserialize)]
struct BibleData {
    books: Vec<Book>,
    verses: Vec<(String, u32, u32, String)>,
}

#[derive(Serialize, Deserialize)]
pub struct Book {
    id: String,
    name: String,
    chapters: u32,
}

#[derive(Serialize)]
pub struct Translation {
    id: String,
    name: String,
}

#[derive(Serialize)]
pub struct Verse {
    verse: u32,
    text: String,
}

#[derive(Serialize)]
pub struct Source {
    id: String,
    name: String,
    path: String,
}

#[derive(Serialize)]
pub struct MediaFile {
    kind: &'static str,
    name: String,
    path: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct KioskBackground {
    name: String,
    url: String,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl Library {
    pub fn open(directory: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(directory)?;
        let mut db = Connection::open(directory.join("lighthouse.sqlite3"))?;
        db.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS workspace (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                project TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kiosk_background (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                name TEXT NOT NULL,
                mime TEXT NOT NULL,
                data BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS translations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS books (
                translation TEXT NOT NULL,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                chapters INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (translation, id)
            );
            CREATE TABLE IF NOT EXISTS verses (
                translation TEXT NOT NULL,
                book TEXT NOT NULL,
                chapter INTEGER NOT NULL,
                verse INTEGER NOT NULL,
                text TEXT NOT NULL,
                PRIMARY KEY (translation, book, chapter, verse)
            );",
        )?;
        for (id, name, source) in BIBLES {
            Self::seed_bible(&mut db, id, name, source)?;
        }
        Ok(Self {
            db: Mutex::new(db),
            picks: Mutex::new(Picks::default()),
        })
    }

    fn seed_bible(
        db: &mut Connection,
        id: &str,
        name: &str,
        source: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM translations WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if exists {
            return Ok(());
        }
        let data: BibleData = serde_json::from_str(source)?;
        let transaction = db.transaction()?;
        transaction.execute(
            "INSERT INTO translations VALUES (?1, ?2)",
            params![id, name],
        )?;
        {
            let mut add_book =
                transaction.prepare("INSERT INTO books VALUES (?1, ?2, ?3, ?4, ?5)")?;
            for (position, book) in data.books.into_iter().enumerate() {
                add_book.execute(params![id, book.id, book.name, book.chapters, position])?;
            }
            let mut add_verse =
                transaction.prepare("INSERT INTO verses VALUES (?1, ?2, ?3, ?4, ?5)")?;
            for (book, chapter, verse, text) in data.verses {
                add_verse.execute(params![id, book, chapter, verse, text])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    fn db(&self) -> CommandResult<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| "The local database is unavailable.".into())
    }

    fn picks(&self) -> CommandResult<MutexGuard<'_, Picks>> {
        self.picks
            .lock()
            .map_err(|_| "File selections are unavailable.".into())
    }

    fn project(&self) -> CommandResult<Option<Value>> {
        let project: Option<String> = self
            .db()?
            .query_row("SELECT project FROM workspace WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(message)?;
        project
            .map(|json| serde_json::from_str(&json).map_err(message))
            .transpose()
    }

    fn kiosk_background(&self) -> CommandResult<Option<KioskBackground>> {
        self.db()?
            .query_row(
                "SELECT name, mime, data FROM kiosk_background WHERE id = 1",
                [],
                |row| {
                    let name: String = row.get(0)?;
                    let mime: String = row.get(1)?;
                    let data: Vec<u8> = row.get(2)?;
                    Ok(KioskBackground {
                        name,
                        url: image_url(&mime, &data),
                    })
                },
            )
            .optional()
            .map_err(message)
    }

    fn save_kiosk_background(&self, background: Option<&KioskBackground>) -> CommandResult<()> {
        if let Some(background) = background {
            let (header, encoded) = background
                .url
                .split_once(',')
                .ok_or("Invalid background image.")?;
            if encoded.len() > MAX_BACKGROUND_SIZE.div_ceil(3) * 4 {
                return Err("Choose an image smaller than 10 MB.".into());
            }
            let data = BASE64
                .decode(encoded)
                .map_err(|_| "Invalid background image.")?;
            let mime = background_mime(&data)?;
            if header != format!("data:{mime};base64") {
                return Err("Invalid background image.".into());
            }
            self.db()?.execute(
                "INSERT INTO kiosk_background VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime, data = excluded.data",
                params![background.name, mime, data],
            ).map_err(message)?;
        } else {
            self.db()?
                .execute("DELETE FROM kiosk_background WHERE id = 1", [])
                .map_err(message)?;
        }
        Ok(())
    }

    fn saved_paths(&self) -> CommandResult<Picks> {
        let Some(project) = self.project()? else {
            return Ok(Picks::default());
        };
        let mut paths = Picks::default();
        if let Some(sources) = project["sources"].as_array() {
            paths.folders.extend(
                sources
                    .iter()
                    .filter_map(|source| source["path"].as_str())
                    .map(PathBuf::from),
            );
        }
        if let Some(playlists) = project["playlists"].as_array() {
            collect_media(playlists, &mut paths.files);
        }
        Ok(paths)
    }
}

fn collect_media(items: &[Value], files: &mut HashSet<PathBuf>) {
    for item in items {
        match item["kind"].as_str() {
            Some("playlist") => {
                if let Some(children) = item["children"].as_array() {
                    collect_media(children, files);
                }
            }
            Some("audio" | "video") => {
                if let Some(path) = item["path"].as_str() {
                    files.insert(PathBuf::from(path));
                }
            }
            _ => {}
        }
    }
}

pub(crate) fn studio_only(window: &WebviewWindow) -> CommandResult<()> {
    if window.label() == "studio" {
        Ok(())
    } else {
        Err("This control is available in Studio.".into())
    }
}

#[tauri::command]
pub fn load_project(
    window: WebviewWindow,
    library: State<'_, Library>,
) -> CommandResult<Option<Value>> {
    studio_only(&window)?;
    library.project()
}

#[tauri::command]
pub fn save_project(
    window: WebviewWindow,
    library: State<'_, Library>,
    project: Value,
) -> CommandResult<()> {
    studio_only(&window)?;
    if project["version"] != 1 || project["playlists"].as_array().is_none_or(Vec::is_empty) {
        return Err("Invalid workspace format.".into());
    }
    let json = serde_json::to_string(&project).map_err(message)?;
    library.db()?.execute(
        "INSERT INTO workspace VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET project = excluded.project",
        [json],
    ).map_err(message)?;
    Ok(())
}

#[tauri::command]
pub fn translations(library: State<'_, Library>) -> CommandResult<Vec<Translation>> {
    let db = library.db()?;
    let mut statement = db
        .prepare("SELECT id, name FROM translations ORDER BY id")
        .map_err(message)?;
    let rows = statement
        .query_map([], |row| {
            Ok(Translation {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(message)?;
    rows.collect::<Result<_, _>>().map_err(message)
}

#[tauri::command]
pub fn books(library: State<'_, Library>, translation: String) -> CommandResult<Vec<Book>> {
    let db = library.db()?;
    let mut statement = db
        .prepare("SELECT id, name, chapters FROM books WHERE translation = ?1 ORDER BY position")
        .map_err(message)?;
    let rows = statement
        .query_map([translation], |row| {
            Ok(Book {
                id: row.get(0)?,
                name: row.get(1)?,
                chapters: row.get(2)?,
            })
        })
        .map_err(message)?;
    rows.collect::<Result<_, _>>().map_err(message)
}

#[tauri::command]
pub fn verses(
    library: State<'_, Library>,
    translation: String,
    book: String,
    chapter: u32,
) -> CommandResult<Vec<Verse>> {
    let db = library.db()?;
    let mut statement = db.prepare(
        "SELECT verse, text FROM verses WHERE translation = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse"
    ).map_err(message)?;
    let rows = statement
        .query_map(params![translation, book, chapter], |row| {
            Ok(Verse {
                verse: row.get(0)?,
                text: row.get(1)?,
            })
        })
        .map_err(message)?;
    rows.collect::<Result<_, _>>().map_err(message)
}

fn path_string(path: &Path) -> CommandResult<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "This file name cannot be represented as text.".into())
}

fn background_mime(data: &[u8]) -> CommandResult<&'static str> {
    if data.len() > MAX_BACKGROUND_SIZE {
        return Err("Choose an image smaller than 10 MB.".into());
    }
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        Ok("image/webp")
    } else {
        Err("Choose a PNG, JPEG, or WebP image.".into())
    }
}

fn image_url(mime: &str, data: &[u8]) -> String {
    format!("data:{mime};base64,{}", BASE64.encode(data))
}

#[tauri::command]
pub fn load_kiosk_background(
    window: WebviewWindow,
    library: State<'_, Library>,
) -> CommandResult<Option<KioskBackground>> {
    if window.label() != "kiosk" {
        studio_only(&window)?;
    }
    library.kiosk_background()
}

#[tauri::command]
pub async fn pick_kiosk_background(
    window: WebviewWindow,
    app: AppHandle,
) -> CommandResult<Option<KioskBackground>> {
    studio_only(&window)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Choose the Kiosk background")
        .add_filter("Images", BACKGROUND_EXTENSIONS)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(message)?;
    if !path.metadata().map_err(message)?.is_file() {
        return Err("Choose an image file.".into());
    }
    let mut data = Vec::new();
    fs::File::open(&path)
        .map_err(message)?
        .take((MAX_BACKGROUND_SIZE + 1) as u64)
        .read_to_end(&mut data)
        .map_err(message)?;
    let mime = background_mime(&data)?;
    let name = path
        .file_name()
        .and_then(|file| file.to_str())
        .unwrap_or("Kiosk background")
        .to_owned();
    Ok(Some(KioskBackground {
        name,
        url: image_url(mime, &data),
    }))
}

#[tauri::command]
pub fn save_kiosk_background(
    window: WebviewWindow,
    app: AppHandle,
    library: State<'_, Library>,
    background: Option<KioskBackground>,
) -> CommandResult<()> {
    studio_only(&window)?;
    library.save_kiosk_background(background.as_ref())?;
    app.emit("kiosk-background-updated", background)
        .map_err(message)
}

fn media_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if VIDEO.contains(&extension.as_str()) {
        Some("video")
    } else if AUDIO.contains(&extension.as_str()) {
        Some("audio")
    } else {
        None
    }
}

fn media_file(path: &Path) -> Option<MediaFile> {
    Some(MediaFile {
        kind: media_kind(path)?,
        name: path.file_name()?.to_str()?.to_owned(),
        path: path_string(path).ok()?,
    })
}

#[tauri::command]
pub async fn pick_folder(
    window: WebviewWindow,
    library: State<'_, Library>,
    app: AppHandle,
) -> CommandResult<Option<Source>> {
    studio_only(&window)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Add a media source")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = dunce::canonicalize(picked.into_path().map_err(message)?).map_err(message)?;
    if !path.is_dir() {
        return Err("Choose a folder to add as a media source.".into());
    }
    let path_text = path_string(&path)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path_text)
        .to_owned();
    library.picks()?.folders.insert(path);
    Ok(Some(Source {
        id: path_text.clone(),
        name,
        path: path_text,
    }))
}

#[tauri::command]
pub async fn pick_media(
    window: WebviewWindow,
    library: State<'_, Library>,
    app: AppHandle,
    kind: Option<String>,
) -> CommandResult<Option<MediaFile>> {
    studio_only(&window)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Open a media file");
    match kind.as_deref() {
        Some("video") => dialog = dialog.add_filter("Video", VIDEO),
        Some("audio") => dialog = dialog.add_filter("Audio", AUDIO),
        _ => {
            let media: Vec<_> = VIDEO.iter().chain(AUDIO).copied().collect();
            dialog = dialog.add_filter("Audio and video", &media);
        }
    }
    let Some(picked) = dialog.blocking_pick_file() else {
        return Ok(None);
    };
    let path = dunce::canonicalize(picked.into_path().map_err(message)?).map_err(message)?;
    let item = media_file(&path).ok_or("Choose a supported video or audio file.")?;
    if kind
        .as_deref()
        .is_some_and(|requested| requested != item.kind)
    {
        return Err(format!(
            "Choose a supported {} file.",
            kind.unwrap_or_default()
        ));
    }
    library.picks()?.files.insert(path);
    Ok(Some(item))
}

#[tauri::command]
pub async fn list_media(
    window: WebviewWindow,
    library: State<'_, Library>,
    path: String,
) -> CommandResult<Vec<MediaFile>> {
    studio_only(&window)?;
    let folder = dunce::canonicalize(&path).map_err(|_| "The media source is unavailable.")?;
    let approved = library.picks()?.folders.contains(&folder)
        || library.saved_paths()?.folders.contains(&folder);
    if !approved {
        return Err("Add this folder as a media source first.".into());
    }
    let mut files = Vec::new();
    let mut pending = vec![folder.clone()];
    while let Some(directory) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory == folder => return Err(message(error)),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                if let Some(item) = media_file(&entry.path()) {
                    files.push(item);
                }
            }
        }
    }
    files.sort_by_cached_key(|file| (file.name.to_lowercase(), file.path.clone()));
    Ok(files)
}

#[tauri::command]
pub async fn authorize_media(
    window: WebviewWindow,
    library: State<'_, Library>,
    app: AppHandle,
    path: String,
) -> CommandResult<String> {
    studio_only(&window)?;
    let file =
        dunce::canonicalize(&path).map_err(|_| "The media file is missing or unavailable.")?;
    let metadata = file.metadata().map_err(message)?;
    if !metadata.is_file() || media_kind(&file).is_none() {
        return Err("Choose a supported audio or video file.".into());
    }
    if metadata.len() == 0 {
        return Err("This media file is empty.".into());
    }
    let saved = library.saved_paths()?;
    let picks = library.picks()?;
    let approved = saved.files.contains(&file)
        || picks.files.contains(&file)
        || saved
            .folders
            .iter()
            .chain(picks.folders.iter())
            .any(|folder| file.starts_with(folder));
    if !approved {
        return Err("Open this file or its source folder in Studio first.".into());
    }
    app.asset_protocol_scope()
        .allow_file(&file)
        .map_err(message)?;
    window.convert_file_src(&file, None).map_err(message)
}
