use super::{
    message, open_bible_file, read_books, studio_only, valid_translation_id, BibleData, Book,
    CommandResult, Library, Translation, BIBLE_SCHEMA,
};
use rusqlite::{backup::Backup, params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiblePreferences {
    disabled_ids: Vec<String>,
    default_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibleSettings {
    databases: Vec<BibleDatabase>,
    pub(super) default_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BibleDatabase {
    #[serde(flatten)]
    pub(super) translation: Translation,
    file_name: Option<String>,
    enabled: bool,
}

#[derive(Deserialize)]
struct JsonBible {
    id: Option<String>,
    name: Option<String>,
    #[serde(flatten)]
    data: BibleData,
}

pub(super) fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS bible_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            preferences TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bible_imports (
            translation TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            stored_file TEXT NOT NULL,
            source_file TEXT NOT NULL
        );",
    )
}

pub(super) fn shared_subfolder(root: &Path, name: &str) -> CommandResult<PathBuf> {
    let directory = root.join(name);
    fs::create_dir_all(&directory).map_err(message)?;
    if !fs::symlink_metadata(&directory).map_err(message)?.is_dir() {
        return Err("The shared Bible storage location is unavailable.".into());
    }
    Ok(directory)
}

fn legacy_language(id: &str) -> Option<&'static str> {
    match id {
        "WEBP" | "WEBPB" => Some("en"),
        id if id.starts_with("H_") => Some("hu"),
        _ => None,
    }
}

fn move_legacy_files(legacy: &Path, shared: &Path, imported: bool) -> CommandResult<()> {
    if !legacy.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(legacy).map_err(message)? {
        let entry = entry.map_err(message)?;
        let path = entry.path();
        if !entry.file_type().map_err(message)?.is_file()
            || path.extension().is_none_or(|ext| ext != "sqlite3")
        {
            continue;
        }
        let language = if imported {
            Some("imported")
        } else {
            path.file_stem()
                .and_then(|name| name.to_str())
                .and_then(legacy_language)
        };
        let directory = match language {
            Some(name) => shared_subfolder(shared, name)?,
            None => shared.to_path_buf(),
        };
        let destination = directory.join(entry.file_name());
        if destination.exists() {
            if fs::read(&path).map_err(message)? != fs::read(&destination).map_err(message)? {
                // A different shared edition is kept in place. Preserve the legacy copy outside the catalog.
                let conflicts = shared_subfolder(shared, "legacy-backup")?;
                let prefix = format!(
                    "{}-",
                    path.file_stem().unwrap_or_default().to_string_lossy()
                );
                let copy = tempfile::Builder::new()
                    .prefix(&prefix)
                    .suffix(".sqlite3")
                    .tempfile_in(conflicts)
                    .map_err(message)?;
                save_legacy_copy(&path, copy.path())?;
                copy.keep().map_err(message)?;
            }
        } else {
            let copy = tempfile::NamedTempFile::new_in(directory).map_err(message)?;
            save_legacy_copy(&path, copy.path())?;
            copy.persist_noclobber(&destination).map_err(message)?;
        }
        fs::remove_file(&path).map_err(message)?;
    }
    Ok(())
}

fn save_legacy_copy(from: &Path, to: &Path) -> CommandResult<()> {
    let source = open_bible_file(from).map_err(message)?;
    let mut copy = Connection::open(to).map_err(message)?;
    Backup::new(&source, &mut copy)
        .and_then(|backup| {
            backup.run_to_completion(1000, std::time::Duration::from_millis(5), None)
        })
        .map_err(message)?;
    copy.execute_batch(BIBLE_SCHEMA).map_err(message)?;
    let integrity: String = copy
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(message)?;
    if integrity != "ok" {
        return Err("An existing Bible translation could not be copied safely.".into());
    }
    Ok(())
}

pub(super) fn migrate_legacy(
    db: &mut Connection,
    legacy: &Path,
    shared: &Path,
) -> CommandResult<()> {
    move_legacy_files(&legacy.join("imported"), shared, true)?;
    move_legacy_files(legacy, shared, false)?;
    // Very early releases also stored bundled Bible text in the workspace database.
    let has_legacy: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'translations')",
        [], |row| row.get(0),
    ).map_err(message)?;
    if !has_legacy {
        return Ok(());
    }
    {
        let mut statement = db
            .prepare("SELECT id, name FROM translations")
            .map_err(message)?;
        let editions = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(message)?;
        for edition in editions {
            let (id, name) = edition.map_err(message)?;
            if !valid_translation_id(&id) {
                return Err("Invalid Bible translation ID.".into());
            }
            let mut books = db
                .prepare(
                    "SELECT id, name, chapters FROM books WHERE translation = ?1 ORDER BY position",
                )
                .map_err(message)?;
            let books = books
                .query_map([&id], |r| {
                    Ok(Book {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        chapters: r.get(2)?,
                        abbreviation: None,
                        alternate_name: None,
                    })
                })
                .map_err(message)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(message)?;
            let mut verses = db.prepare("SELECT book, chapter, verse, text FROM verses WHERE translation = ?1 ORDER BY book, chapter, verse").map_err(message)?;
            let verses = verses
                .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .map_err(message)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(message)?;
            let installed = direct_bible_path(shared, &id)?;
            if let Some(path) = &installed {
                let database = open_bible_file(path).map_err(message)?;
                let mut query = database.prepare("SELECT book, chapter, verse, text FROM verses WHERE translation = ?1 ORDER BY book, chapter, verse").map_err(message)?;
                let existing = query
                    .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                    .map_err(message)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(message)?;
                if existing == verses {
                    continue;
                }
            }
            let directory = if installed.is_some() {
                shared_subfolder(shared, "legacy-backup")?
            } else if let Some(language) = legacy_language(&id) {
                shared_subfolder(shared, language)?
            } else {
                shared.to_path_buf()
            };
            let copy = tempfile::Builder::new()
                .prefix(&format!("{id}-"))
                .suffix(".sqlite3")
                .tempfile_in(&directory)
                .map_err(message)?;
            {
                let mut target = Connection::open(copy.path()).map_err(message)?;
                target
                    .pragma_update(None, "foreign_keys", true)
                    .map_err(message)?;
                let transaction = target.transaction().map_err(message)?;
                transaction.execute_batch(BIBLE_SCHEMA).map_err(message)?;
                Library::store_bible(&transaction, &id, &name, BibleData { books, verses })
                    .map_err(message)?;
                validate_editions(&transaction)?;
                transaction.commit().map_err(message)?;
            }
            if installed.is_some() {
                copy.keep().map_err(message)?;
            } else {
                copy.persist_noclobber(directory.join(format!("{id}.sqlite3")))
                    .map_err(message)?;
            }
        }
    }
    db.pragma_update(None, "secure_delete", true)
        .map_err(message)?;
    let transaction = db.transaction().map_err(message)?;
    transaction
        .execute_batch(
            "DROP TABLE IF EXISTS book_aliases; DROP TABLE IF EXISTS translation_sources;
         DROP TABLE IF EXISTS verses; DROP TABLE IF EXISTS books; DROP TABLE translations;",
        )
        .map_err(message)?;
    transaction.commit().map_err(message)
}

fn imports_directory(library: &Library) -> PathBuf {
    library.bible_directory.join("imported")
}

pub(super) fn imported_path(
    library: &Library,
    db: &Connection,
    translation: &str,
) -> CommandResult<Option<PathBuf>> {
    let directory = imports_directory(library);
    if !directory
        .symlink_metadata()
        .is_ok_and(|entry| entry.is_dir())
    {
        return Ok(None);
    }
    let file: Option<String> = db
        .query_row(
            "SELECT stored_file FROM bible_imports WHERE translation = ?1",
            [translation],
            |row| row.get(0),
        )
        .optional()
        .map_err(message)?;
    Ok(file
        .filter(|file| {
            Path::new(file).file_name().and_then(|name| name.to_str()) == Some(file.as_str())
        })
        .map(|file| directory.join(file))
        .filter(|path| path.symlink_metadata().is_ok_and(|entry| entry.is_file())))
}

pub(super) fn language_folder(name: &str) -> bool {
    (2..=3).contains(&name.len()) && name.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn direct_bible_files(root: &Path) -> CommandResult<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(root).map_err(message)? {
        let entry = entry.map_err(message)?;
        let kind = entry.file_type().map_err(message)?;
        if kind.is_file() {
            paths.push(entry.path());
        } else if kind.is_dir() && entry.file_name().to_str().is_some_and(language_folder) {
            for child in fs::read_dir(entry.path()).map_err(message)? {
                let child = child.map_err(message)?;
                if child.file_type().map_err(message)?.is_file() {
                    paths.push(child.path());
                }
            }
        }
    }
    paths.retain(|path| {
        path.extension().is_some_and(|ext| ext == "sqlite3")
            && path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(valid_translation_id)
    });
    paths.sort_unstable();
    Ok(paths)
}

pub(super) fn direct_bible_path(root: &Path, id: &str) -> CommandResult<Option<PathBuf>> {
    Ok(direct_bible_files(root)?.into_iter().find(|path| {
        path.file_stem().is_some_and(|stem| stem == id) && edition_name(path, id).is_ok()
    }))
}

fn edition_name(path: &Path, id: &str) -> rusqlite::Result<String> {
    open_bible_file(path)?.query_row("SELECT name FROM translations WHERE id = ?1", [id], |row| {
        row.get(0)
    })
}

pub(super) fn catalog(library: &Library, db: &Connection) -> CommandResult<Vec<BibleDatabase>> {
    let mut databases = Vec::new();
    let mut installed = HashSet::new();
    for path in direct_bible_files(&library.bible_directory)? {
        let id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        if let Ok(name) = edition_name(&path, id) {
            if installed.insert(id.to_ascii_lowercase()) {
                databases.push(BibleDatabase {
                    translation: Translation {
                        id: id.into(),
                        name,
                    },
                    file_name: path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned()),
                    enabled: true,
                });
            }
        }
    }
    let mut statement = db
        .prepare("SELECT translation, name, source_file FROM bible_imports")
        .map_err(message)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                Translation {
                    id: row.get(0)?,
                    name: row.get(1)?,
                },
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(message)?;
    for row in rows {
        let (translation, file_name) = row.map_err(message)?;
        if installed.insert(translation.id.to_ascii_lowercase())
            && imported_path(library, db, &translation.id)?.is_some()
        {
            databases.push(BibleDatabase {
                translation,
                file_name: Some(file_name),
                enabled: true,
            });
        }
    }
    databases.sort_by(|a, b| a.translation.id.cmp(&b.translation.id));
    Ok(databases)
}

pub(super) fn read_preferences(db: &Connection) -> CommandResult<BiblePreferences> {
    let saved: Option<String> = db
        .query_row(
            "SELECT preferences FROM bible_preferences WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(message)?;
    match saved {
        Some(json) => serde_json::from_str(&json).map_err(message),
        None => Ok(BiblePreferences {
            disabled_ids: Vec::new(),
            default_id: Some("WEBP".into()),
        }),
    }
}

pub(super) fn settings(
    mut databases: Vec<BibleDatabase>,
    preferences: &BiblePreferences,
) -> BibleSettings {
    let disabled: HashSet<_> = preferences.disabled_ids.iter().collect();
    for item in &mut databases {
        item.enabled = !disabled.contains(&item.translation.id);
    }
    let default_id = databases
        .iter()
        .find(|item| item.enabled && preferences.default_id.as_ref() == Some(&item.translation.id))
        .or_else(|| databases.iter().find(|item| item.enabled))
        .map(|item| item.translation.id.clone());
    BibleSettings {
        databases,
        default_id,
    }
}

#[tauri::command]
pub fn load_bible_settings(
    window: WebviewWindow,
    library: State<'_, Library>,
) -> CommandResult<BibleSettings> {
    studio_only(&window)?;
    let db = library.db()?;
    Ok(settings(catalog(&library, &db)?, &read_preferences(&db)?))
}

#[tauri::command]
pub fn save_bible_settings(
    window: WebviewWindow,
    library: State<'_, Library>,
    preferences: BiblePreferences,
) -> CommandResult<BibleSettings> {
    studio_only(&window)?;
    write_preferences(&library, preferences)
}

fn write_preferences(
    library: &Library,
    preferences: BiblePreferences,
) -> CommandResult<BibleSettings> {
    let db = library.db()?;
    persist_preferences(&db, settings(catalog(library, &db)?, &preferences))
}

fn persist_preferences(db: &Connection, settings: BibleSettings) -> CommandResult<BibleSettings> {
    let preferences = BiblePreferences {
        disabled_ids: settings
            .databases
            .iter()
            .filter(|item| !item.enabled)
            .map(|item| item.translation.id.clone())
            .collect(),
        default_id: settings.default_id.clone(),
    };
    let json = serde_json::to_string(&preferences).map_err(message)?;
    db.execute(
        "INSERT INTO bible_preferences VALUES (1, ?1)
        ON CONFLICT(id) DO UPDATE SET preferences = excluded.preferences",
        [json],
    )
    .map_err(message)?;
    Ok(settings)
}

#[tauri::command]
pub fn remove_bible(
    window: WebviewWindow,
    library: State<'_, Library>,
    id: String,
) -> CommandResult<BibleSettings> {
    studio_only(&window)?;
    remove_translation(&library, &id)
}

fn remove_translation(library: &Library, id: &str) -> CommandResult<BibleSettings> {
    if !valid_translation_id(id) {
        return Err("Invalid Bible translation ID.".into());
    }
    let mut db = library.db()?;
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(message)?;
    let preferences = read_preferences(&transaction)?;
    let mut installed = catalog(library, &transaction)?;
    let Some(index) = installed
        .iter()
        .position(|item| item.translation.id.eq_ignore_ascii_case(id))
    else {
        return Ok(settings(installed, &preferences));
    };
    let id = installed.remove(index).translation.id;

    // Resolve local copies from the installed catalog, including pre-download imports.
    let mut paths = Vec::new();
    for path in direct_bible_files(&library.bible_directory)? {
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            if stem.eq_ignore_ascii_case(&id) && edition_name(&path, stem).is_ok() {
                paths.push((path.clone(), stem.to_owned()));
            }
        }
    }
    let imported_id: Option<String> = transaction
        .query_row(
            "SELECT translation FROM bible_imports WHERE translation = ?1 COLLATE NOCASE",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(message)?;
    if let Some(imported_id) = imported_id {
        if let Some(path) = imported_path(library, &transaction, &imported_id)? {
            paths.push((path, imported_id.clone()));
        }
        transaction
            .execute(
                "DELETE FROM bible_imports WHERE translation = ?1",
                [imported_id],
            )
            .map_err(message)?;
    }
    let updated = persist_preferences(&transaction, settings(installed, &preferences))?;
    let mut originals = Vec::new();
    let removed = (|| {
        for (path, edition) in paths {
            let parent = path.parent().ok_or("Invalid Bible location.")?;
            let staging = tempfile::tempdir_in(parent).map_err(message)?;
            let replacement = staging.path().join("remaining");
            let keep_others = prepare_remaining_editions(&path, &edition, &replacement)?;
            fs::rename(&path, staging.path().join("original")).map_err(message)?;
            originals.push((path.clone(), staging));
            if keep_others {
                fs::rename(replacement, path).map_err(message)?;
            }
        }
        transaction.commit().map_err(message)
    })();
    if let Err(error) = removed {
        for (path, staging) in originals.into_iter().rev() {
            if fs::rename(staging.path().join("original"), path).is_err() {
                // Preserve the original if an external file lock prevents restoration.
                let _ = staging.keep();
            }
        }
        return Err(error);
    }
    Ok(updated)
}

// Older imports can hold several editions. Preserve the complete original schema
// and remove just this edition from a copy before replacing the installed file.
fn prepare_remaining_editions(path: &Path, id: &str, replacement: &Path) -> CommandResult<bool> {
    let source = open_bible_file(path).map_err(message)?;
    let has_others: bool = source
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM translations WHERE id <> ?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(message)?;
    if !has_others {
        return Ok(false);
    }
    let mut target = Connection::open(replacement).map_err(message)?;
    Backup::new(&source, &mut target)
        .and_then(|backup| {
            backup.run_to_completion(1000, std::time::Duration::from_millis(5), None)
        })
        .map_err(message)?;
    target
        .pragma_update(None, "trusted_schema", false)
        .map_err(message)?;
    target
        .pragma_update(None, "secure_delete", true)
        .map_err(message)?;
    target
        .set_db_config(
            rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER,
            false,
        )
        .map_err(message)?;
    let tx = target.transaction().map_err(message)?;
    tx.execute_batch(BIBLE_SCHEMA).map_err(message)?;
    for table in ["translation_sources", "book_aliases", "verses", "books"] {
        tx.execute(&format!("DELETE FROM {table} WHERE translation = ?1"), [id])
            .map_err(message)?;
    }
    tx.execute("DELETE FROM translations WHERE id = ?1", [id])
        .map_err(message)?;
    tx.commit().map_err(message)?;
    Ok(true)
}

fn import_json(source: &Path, target: &mut Connection) -> CommandResult<()> {
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("Invalid Bible file name.")?;
    let reader = BufReader::new(File::open(source).map_err(message)?);
    let file: JsonBible = serde_json::from_reader(reader)
        .map_err(|reason| format!("Invalid Bible JSON file. {reason}"))?;
    let id = file.id.unwrap_or_else(|| {
        stem.chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-') {
                    ch
                } else {
                    '_'
                }
            })
            .collect()
    });
    let name = file.name.unwrap_or_else(|| stem.into());
    let books: HashMap<_, _> = file
        .data
        .books
        .iter()
        .map(|book| (&book.id, book.chapters))
        .collect();
    if !valid_translation_id(&id)
        || name.trim().is_empty()
        || books.is_empty()
        || books.len() != file.data.books.len()
        || file.data.verses.is_empty()
        || file.data.books.iter().any(|book| {
            book.id.trim().is_empty()
                || book.name.trim().is_empty()
                || !(1..=999).contains(&book.chapters)
        })
        || file.data.verses.iter().any(|(book, chapter, verse, text)| {
            *chapter == 0
                || *verse == 0
                || text.trim().is_empty()
                || books.get(book).is_none_or(|last| chapter > last)
        })
    {
        return Err("This file does not contain valid Bible books and verses. Translation IDs can use letters, numbers, hyphens, and underscores.".into());
    }
    target
        .pragma_update(None, "foreign_keys", true)
        .map_err(message)?;
    let transaction = target.transaction().map_err(message)?;
    transaction.execute_batch(BIBLE_SCHEMA).map_err(message)?;
    Library::store_bible(&transaction, &id, &name, file.data).map_err(message)?;
    transaction.commit().map_err(message)
}

fn prepare_import(source: &Path, target: &mut Connection) -> CommandResult<Vec<Translation>> {
    match source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("json") => import_json(source, target)?,
        Some("db" | "sqlite" | "sqlite3") => {
            let source = open_bible_file(source).map_err(message)?;
            Backup::new(&source, target)
                .and_then(|backup| {
                    backup.run_to_completion(1000, std::time::Duration::from_millis(5), None)
                })
                .map_err(|_| "Could not read the Bible translation.")?;
            // Earlier files may lack optional book aliases and source metadata.
            target.execute_batch(BIBLE_SCHEMA).map_err(message)?;
        }
        _ => return Err("Choose a supported Bible translation file.".into()),
    }

    validate_editions(target)
}

pub(super) fn validate_editions(target: &Connection) -> CommandResult<Vec<Translation>> {
    let mut statement = target
        .prepare("SELECT id, name FROM translations ORDER BY id")
        .map_err(message)?;
    let editions = statement
        .query_map([], |row| {
            Ok(Translation {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(message)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(message)?;
    let mut ids = HashSet::new();
    for edition in &editions {
        let books = read_books(target, &edition.id)?;
        let has_verses = target.query_row(
            "SELECT EXISTS(SELECT 1 FROM verses v JOIN books b ON b.translation = v.translation AND b.id = v.book
                WHERE v.translation = ?1 AND v.chapter BETWEEN 1 AND b.chapters AND v.verse > 0 AND length(v.text) > 0)",
            [&edition.id], |row| row.get::<_, bool>(0),
        ).map_err(message)?;
        if !valid_translation_id(&edition.id)
            || !ids.insert(edition.id.to_ascii_lowercase())
            || edition.name.trim().is_empty()
            || books.is_empty()
            || !has_verses
        {
            return Err("This file does not contain valid Bible editions.".into());
        }
    }
    if editions.is_empty() {
        return Err(
            "This file does not contain any editions in the Lighthouse Media Center Bible schema."
                .into(),
        );
    }
    Ok(editions)
}

fn import_file(library: &Library, source: &Path) -> CommandResult<BibleSettings> {
    let source_file = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid Bible file name.")?;
    let directory = shared_subfolder(&library.bible_directory, "imported")?;
    let stored_file: String = library
        .db()?
        .query_row(
            "SELECT lower(hex(randomblob(16))) || '.sqlite3'",
            [],
            |row| row.get(0),
        )
        .map_err(message)?;
    let path = directory.join(&stored_file);
    let pending = tempfile::NamedTempFile::new_in(&directory).map_err(message)?;
    let mut target = Connection::open(pending.path()).map_err(message)?;
    target
        .pragma_update(None, "trusted_schema", false)
        .map_err(message)?;
    let mut editions = prepare_import(source, &mut target)?;
    drop(target);

    let mut db = library.db()?;
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(message)?;
    let existing: HashSet<_> = catalog(library, &transaction)?
        .into_iter()
        .map(|item| item.translation.id.to_ascii_lowercase())
        .collect();
    editions.retain(|edition| !existing.contains(&edition.id.to_ascii_lowercase()));
    if editions.is_empty() {
        return Err("All Bible editions in this file are already available.".into());
    }
    for edition in editions {
        transaction
            .execute(
                "INSERT INTO bible_imports VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(translation) DO UPDATE SET name = excluded.name,
                stored_file = excluded.stored_file, source_file = excluded.source_file",
                params![edition.id, edition.name, stored_file, source_file],
            )
            .map_err(message)?;
    }
    let moved = pending.persist_noclobber(&path).map_err(message)?;
    let result = (|| {
        let updated = settings(
            catalog(library, &transaction)?,
            &read_preferences(&transaction)?,
        );
        transaction.commit().map_err(message)?;
        Ok(updated)
    })();
    drop(moved);
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

#[tauri::command]
pub async fn import_bible(
    window: WebviewWindow,
    library: State<'_, Library>,
    app: AppHandle,
    title: Option<String>,
    filter_name: Option<String>,
) -> CommandResult<Option<BibleSettings>> {
    studio_only(&window)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title.as_deref().unwrap_or("Add a Bible translation"))
        .add_filter(
            filter_name.as_deref().unwrap_or("Bible translations"),
            &["sqlite", "sqlite3", "db", "json"],
        )
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(message)?;
    import_file(&library, &path).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_legacy_verse_data_to_the_shared_folder_and_preserves_the_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let app = directory.path().join("app");
        let legacy = app.join("bibles");
        let shared = directory.path().join("shared");
        fs::create_dir_all(&legacy).unwrap();
        let main = Connection::open(app.join("lighthouse.sqlite3")).unwrap();
        main.execute_batch(BIBLE_SCHEMA).unwrap();
        main.execute_batch(
            "INSERT INTO translations VALUES ('WEBP', 'Legacy English');
             INSERT INTO books VALUES ('WEBP', 'GEN', 'Genesis', 1, 0);
             INSERT INTO verses VALUES ('WEBP', 'GEN', 1, 1, 'Legacy verse');
             CREATE TABLE workspace (id INTEGER PRIMARY KEY, project TEXT NOT NULL);
             INSERT INTO workspace VALUES (1, '{}');",
        )
        .unwrap();
        drop(main);
        let separate = Connection::open(legacy.join("H_Test.sqlite3")).unwrap();
        separate.execute_batch(BIBLE_SCHEMA).unwrap();
        separate
            .execute_batch(
                "INSERT INTO translations VALUES ('H_Test', 'Legacy Hungarian');
             INSERT INTO books VALUES ('H_Test', 'GEN', 'Teremtés', 1, 0);
             INSERT INTO verses VALUES ('H_Test', 'GEN', 1, 1, 'Magyar vers');",
            )
            .unwrap();
        drop(separate);

        let library = Library::open(&app, shared.clone()).unwrap();
        assert!(shared.join("en/WEBP.sqlite3").is_file());
        assert!(shared.join("hu/H_Test.sqlite3").is_file());
        assert!(!legacy.join("H_Test.sqlite3").exists());
        assert!(library.open_bible("WEBP").is_ok());
        assert!(library.open_bible("H_Test").is_ok());
        let main = library.db().unwrap();
        let old_tables: u32 = main.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name IN ('translations', 'books', 'verses')",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(old_tables, 0);
        assert_eq!(library.bible_directory, shared);
        let project: String = main
            .query_row("SELECT project FROM workspace", [], |r| r.get(0))
            .unwrap();
        assert_eq!(project, "{}");
    }

    #[test]
    fn removes_downloaded_and_imported_translations_and_updates_the_default() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let library = Library::open(&root.join("app"), root.join("shared")).unwrap();
        let downloaded = root.join("shared/WEBP.sqlite3");
        let db = Connection::open(&downloaded).unwrap();
        db.execute_batch(BIBLE_SCHEMA).unwrap();
        db.execute("INSERT INTO translations VALUES ('WEBP', 'English')", [])
            .unwrap();
        drop(db);
        let collection = root.join("collection.sqlite3");
        let db = Connection::open(&collection).unwrap();
        db.execute_batch(BIBLE_SCHEMA).unwrap();
        db.execute_batch("INSERT INTO translations VALUES ('A','First'), ('B','Second');
            INSERT INTO books VALUES ('A','GEN','Genesis',1,0), ('B','GEN','Genesis',1,0);
            INSERT INTO verses VALUES ('A','GEN',1,1,'First verse'), ('B','GEN',1,1,'Second verse');").unwrap();
        drop(db);
        import_file(&library, &collection).unwrap();

        let after = remove_translation(&library, "WEBP").unwrap();
        assert!(!downloaded.exists());
        assert_eq!(after.default_id.as_deref(), Some("A"));
        let after = remove_translation(&library, "a").unwrap();
        assert_eq!(after.default_id.as_deref(), Some("B"));
        assert!(library.open_bible("A").is_err());
        let remaining = library.open_bible("B").unwrap();
        assert_eq!(
            remaining
                .query_row("SELECT text FROM verses", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Second verse"
        );
        assert_eq!(
            remaining
                .query_row("SELECT count(*) FROM verses", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            1
        );
        drop(remaining);
        assert!(remove_translation(&library, "B")
            .unwrap()
            .databases
            .is_empty());
        assert!(remove_translation(&library, "B")
            .unwrap()
            .default_id
            .is_none());
        assert_eq!(
            fs::read_dir(imports_directory(&library)).unwrap().count(),
            0
        );
        assert!(collection.exists());
    }

    #[test]
    fn imports_new_editions_and_preserves_preferences_and_aliases() {
        let directory =
            std::env::temp_dir().join(format!("lighthouse-bible-test-{}", std::process::id()));
        let library = Library::open(&directory, directory.join("shared")).unwrap();
        let english = directory.join("shared/WEBP.sqlite3");
        let bundled = Connection::open(english).unwrap();
        bundled.execute_batch(BIBLE_SCHEMA).unwrap();
        bundled
            .execute_batch(
                "INSERT INTO translations VALUES ('WEBP', 'World English Bible');
             INSERT INTO books VALUES ('WEBP', 'GEN', 'Genesis', 1, 0);
             INSERT INTO verses VALUES ('WEBP', 'GEN', 1, 1, 'English verse');",
            )
            .unwrap();
        drop(bundled);
        let source = directory.join("collection.sqlite3");
        let db = Connection::open(&source).unwrap();
        db.execute_batch(BIBLE_SCHEMA).unwrap();
        db.execute_batch(
            "INSERT INTO translations VALUES ('WEBP', 'Bundled duplicate'), ('HU', 'Hungarian fixture');
             INSERT INTO books VALUES ('WEBP', 'GEN', 'Genesis', 1, 0), ('HU', 'GEN', 'Teremtés', 1, 0);
             INSERT INTO verses VALUES ('WEBP', 'GEN', 1, 1, 'English verse'), ('HU', 'GEN', 1, 1, 'Magyar vers');
             INSERT INTO book_aliases VALUES ('HU', 'GEN', 'Mózes első könyve', '1Móz');",
        ).unwrap();
        drop(db);

        let imported = import_file(&library, &source).unwrap();
        assert_eq!(imported.databases.len(), 2);
        assert_eq!(imported.default_id.as_deref(), Some("WEBP"));
        assert!(import_file(&library, &source).is_err());
        write_preferences(
            &library,
            BiblePreferences {
                disabled_ids: vec!["WEBP".into()],
                default_id: Some("HU".into()),
            },
        )
        .unwrap();
        fs::remove_file(source).unwrap();
        drop(library);

        let library = Library::open(&directory, directory.join("shared")).unwrap();
        assert!(!directory.join("bibles").exists());
        let db = library.db().unwrap();
        let set = settings(
            catalog(&library, &db).unwrap(),
            &read_preferences(&db).unwrap(),
        );
        drop(db);
        assert_eq!(set.default_id.as_deref(), Some("HU"));
        assert!(set
            .databases
            .iter()
            .any(|item| item.translation.id == "WEBP" && !item.enabled));
        let books = read_books(&library.open_bible("HU").unwrap(), "HU").unwrap();
        assert_eq!(books[0].abbreviation.as_deref(), Some("1Móz"));
        assert!(!read_books(&library.open_bible("WEBP").unwrap(), "WEBP")
            .unwrap()
            .is_empty());
        drop(library);
        fs::remove_dir_all(directory).unwrap();
    }
}
