use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[path = "bible_downloads.rs"]
pub(crate) mod bible_downloads;
#[path = "bible_settings.rs"]
pub(crate) mod bible_settings;
#[path = "slide_settings.rs"]
pub(crate) mod slide_settings;

const VIDEO: &[&str] = &["mp4", "m4v", "mov", "webm", "ogv"];
const AUDIO: &[&str] = &["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"];
const BACKGROUND_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];
const MAX_BACKGROUND_SIZE: usize = 10 * 1024 * 1024;
const BIBLE_SCHEMA: &str = include_str!("../bible/schema.sql");
type CommandResult<T> = Result<T, String>;

pub struct Library {
    db: Mutex<Connection>,
    bible_directory: PathBuf,
    picks: Mutex<Picks>,
}

#[derive(Default)]
struct Picks {
    folders: HashSet<PathBuf>,
    files: HashSet<PathBuf>,
}

#[derive(Deserialize, Serialize)]
pub struct BibleData {
    books: Vec<Book>,
    verses: Vec<(String, u32, u32, String)>,
}

#[derive(Serialize, Deserialize)]
pub struct Book {
    id: String,
    name: String,
    chapters: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    abbreviation: Option<String>,
    #[serde(
        default,
        rename = "alternateName",
        skip_serializing_if = "Option::is_none"
    )]
    alternate_name: Option<String>,
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
pub struct BackgroundImage {
    name: String,
    url: String,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl Library {
    pub fn open(
        directory: &Path,
        bible_directory: PathBuf,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(directory)?;
        let mut db = Connection::open(directory.join("lighthouse.sqlite3"))?;
        db.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS workspace (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                project TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playback_preferences (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                fade INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kiosk_background (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                name TEXT NOT NULL,
                mime TEXT NOT NULL,
                data BLOB NOT NULL
            );
            ",
        )?;
        bible_settings::initialize(&db)?;
        slide_settings::initialize(&db)?;
        fs::create_dir_all(&bible_directory)?;
        bible_settings::migrate_legacy(&mut db, &directory.join("bibles"), &bible_directory)?;
        Ok(Self {
            db: Mutex::new(db),
            bible_directory,
            picks: Mutex::new(Picks::default()),
        })
    }

    fn store_bible(db: &Connection, id: &str, name: &str, data: BibleData) -> rusqlite::Result<()> {
        db.execute("INSERT INTO translations VALUES (?1, ?2)", params![id, name])?;
        let mut add_book = db.prepare("INSERT INTO books VALUES (?1, ?2, ?3, ?4, ?5)")?;
        let mut add_alias = db.prepare("INSERT INTO book_aliases VALUES (?1, ?2, ?3, ?4)")?;
        for (position, book) in data.books.into_iter().enumerate() {
            add_book.execute(params![id, book.id, book.name, book.chapters, position])?;
            if book.alternate_name.is_some() || book.abbreviation.is_some() {
                add_alias.execute(params![
                    id, book.id, book.alternate_name.as_deref().unwrap_or(&book.name),
                    book.abbreviation.unwrap_or_default(),
                ])?;
            }
        }
        let mut add_verse = db.prepare("INSERT INTO verses VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for (book, chapter, verse, text) in data.verses {
            add_verse.execute(params![id, book, chapter, verse, text])?;
        }
        Ok(())
    }

    fn db(&self) -> CommandResult<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| "The local library is unavailable.".into())
    }

    pub fn load_fade(&self) -> CommandResult<bool> {
        let fade = self
            .db()?
            .query_row(
                "SELECT fade FROM playback_preferences WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(message)?;
        Ok(fade.unwrap_or(false))
    }

    pub fn save_fade(&self, enabled: bool) -> CommandResult<()> {
        self.db()?.execute(
            "INSERT INTO playback_preferences (id, fade) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET fade = excluded.fade",
            [enabled],
        ).map_err(message)?;
        Ok(())
    }

    fn open_bible(&self, translation: &str) -> CommandResult<Connection> {
        if !valid_translation_id(translation) {
            return Err("Invalid Bible translation ID.".into());
        }
        let path = match bible_settings::direct_bible_path(&self.bible_directory, translation)? {
            Some(path) => Some(path),
            None => {
                let db = self.db()?;
                bible_settings::imported_path(self, &db, translation)?
            }
        }
        .ok_or_else(|| format!("Bible edition {translation} is not installed."))?;
        open_bible_file(&path)
            .map_err(|_| "Could not read the Bible translation.".into())
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

    fn kiosk_background(&self) -> CommandResult<Option<BackgroundImage>> {
        self.db()?
            .query_row(
                "SELECT name, mime, data FROM kiosk_background WHERE id = 1",
                [],
                |row| {
                    let name: String = row.get(0)?;
                    let mime: String = row.get(1)?;
                    let data: Vec<u8> = row.get(2)?;
                    Ok(BackgroundImage {
                        name,
                        url: image_url(&mime, &data),
                    })
                },
            )
            .optional()
            .map_err(message)
    }

    fn save_kiosk_background(&self, background: Option<&BackgroundImage>) -> CommandResult<()> {
        if let Some(background) = background {
            let (mime, data) = decode_background(&background.url)?;
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
    if project["version"] != 1 || !project["playlists"].is_array() {
        return Err("Invalid workspace format.".into());
    }
    let json = serde_json::to_string(&project).map_err(message)?;
    library.db()?.execute(
        "INSERT INTO workspace VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET project = excluded.project",
        [json],
    ).map_err(message)?;
    Ok(())
}

fn valid_translation_id(id: &str) -> bool {
    !id.is_empty()
        && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn open_bible_file(path: &Path) -> rusqlite::Result<Connection> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.pragma_update(None, "trusted_schema", false)?;
    Ok(db)
}

fn read_books(db: &Connection, translation: &str) -> CommandResult<Vec<Book>> {
    let sql = "SELECT b.id, b.name, b.chapters, NULLIF(a.hungarian_abbreviation, ''),
                      NULLIF(a.source_book_name, b.name)
               FROM books b LEFT JOIN book_aliases a ON a.translation = b.translation AND a.book = b.id
               WHERE b.translation = ?1 ORDER BY b.position";
    let mut statement = db.prepare(sql).map_err(message)?;
    let rows = statement
        .query_map([translation], |row| {
            Ok(Book {
                id: row.get(0)?,
                name: row.get(1)?,
                chapters: row.get(2)?,
                abbreviation: row.get(3)?,
                alternate_name: row.get(4)?,
            })
        })
        .map_err(message)?;
    rows.collect::<Result<_, _>>().map_err(message)
}

fn verse_text(text: String) -> String {
    if !text.contains('<') {
        return text;
    }

    // The source places section headings inside some verse records.
    let mut remaining = text.as_str();
    let mut plain = String::with_capacity(text.len());
    while let Some((before, after)) = remaining.split_once("<TS>") {
        plain.push_str(before);
        match after.split_once("<Ts>") {
            Some((_, verse)) => remaining = verse,
            None => {
                remaining = after;
                break;
            }
        }
    }
    plain.push_str(remaining);
    plain
        .replace("<CL>", "\n")
        .replace("<CM>", "\n")
        .replace("<FI>", "")
        .replace("<Fi>", "")
        .replace("<Ts>", "")
        .trim()
        .to_owned()
}

#[tauri::command]
pub fn books(library: State<'_, Library>, translation: String) -> CommandResult<Vec<Book>> {
    read_books(&library.open_bible(&translation)?, &translation)
}

#[tauri::command]
pub fn verses(
    library: State<'_, Library>,
    translation: String,
    book: String,
    chapter: u32,
) -> CommandResult<Vec<Verse>> {
    let db = library.open_bible(&translation)?;
    let mut statement = db.prepare(
        "SELECT verse, text FROM verses WHERE translation = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse"
    ).map_err(message)?;
    let rows = statement
        .query_map(params![translation, book, chapter], |row| {
            Ok(Verse {
                verse: row.get(0)?,
                text: verse_text(row.get(1)?),
            })
        })
        .map_err(message)?;
    rows.collect::<Result<_, _>>().map_err(message)
}

#[tauri::command]
pub async fn bible_search_data(
    library: State<'_, Library>,
    translation: String,
) -> CommandResult<BibleData> {
    let db = library.open_bible(&translation)?;
    let books = read_books(&db, &translation)?;
    let mut statement = db
        .prepare(
            "SELECT v.book, v.chapter, v.verse, v.text
             FROM verses v JOIN books b ON b.translation = v.translation AND b.id = v.book
             WHERE v.translation = ?1 ORDER BY b.position, v.chapter, v.verse",
        )
        .map_err(message)?;
    let rows = statement
        .query_map([&translation], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                verse_text(row.get(3)?),
            ))
        })
        .map_err(message)?;
    let verses = rows.collect::<Result<_, _>>().map_err(message)?;
    Ok(BibleData { books, verses })
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

fn decode_background(url: &str) -> CommandResult<(&'static str, Vec<u8>)> {
    let (header, encoded) = url.split_once(',').ok_or("Invalid background image.")?;
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
    Ok((mime, data))
}

fn image_url(mime: &str, data: &[u8]) -> String {
    format!("data:{mime};base64,{}", BASE64.encode(data))
}

#[tauri::command]
pub fn load_kiosk_background(
    window: WebviewWindow,
    library: State<'_, Library>,
) -> CommandResult<Option<BackgroundImage>> {
    if window.label() != "kiosk" {
        studio_only(&window)?;
    }
    library.kiosk_background()
}

#[tauri::command]
pub async fn pick_kiosk_background(
    window: WebviewWindow,
    app: AppHandle,
    title: Option<String>,
    filter_name: Option<String>,
) -> CommandResult<Option<BackgroundImage>> {
    studio_only(&window)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title.as_deref().unwrap_or("Choose the Kiosk background"))
        .add_filter(
            filter_name.as_deref().unwrap_or("Images"),
            BACKGROUND_EXTENSIONS,
        )
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
    Ok(Some(BackgroundImage {
        name,
        url: image_url(mime, &data),
    }))
}

#[tauri::command]
pub fn save_kiosk_background(
    window: WebviewWindow,
    app: AppHandle,
    library: State<'_, Library>,
    background: Option<BackgroundImage>,
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
    title: Option<String>,
) -> CommandResult<Option<Source>> {
    studio_only(&window)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title.as_deref().unwrap_or("Add a media source"))
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
    title: Option<String>,
    filter_name: Option<String>,
) -> CommandResult<Option<MediaFile>> {
    studio_only(&window)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title.as_deref().unwrap_or("Open a media file"));
    match kind.as_deref() {
        Some("video") => {
            dialog = dialog.add_filter(filter_name.as_deref().unwrap_or("Video"), VIDEO);
        }
        Some("audio") => {
            dialog = dialog.add_filter(filter_name.as_deref().unwrap_or("Audio"), AUDIO);
        }
        _ => {
            let media: Vec<_> = VIDEO.iter().chain(AUDIO).copied().collect();
            dialog = dialog.add_filter(filter_name.as_deref().unwrap_or("Audio and video"), &media);
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
