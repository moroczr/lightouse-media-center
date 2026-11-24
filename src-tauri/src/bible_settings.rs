use super::{
    message, open_bible_file, read_books, studio_only, valid_translation_id, BibleData,
    CommandResult, Library, Translation, BIBLES, BIBLE_SCHEMA,
};
use rusqlite::{backup::Backup, params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
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
    default_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BibleDatabase {
    #[serde(flatten)]
    translation: Translation,
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

fn imports_directory(library: &Library) -> PathBuf {
    library.bible_directory.join("imported")
}

pub(super) fn imported_path(
    library: &Library,
    db: &Connection,
    translation: &str,
) -> CommandResult<Option<PathBuf>> {
    let file: Option<String> = db
        .query_row(
            "SELECT stored_file FROM bible_imports WHERE translation = ?1",
            [translation],
            |row| row.get(0),
        )
        .optional()
        .map_err(message)?;
    Ok(file.map(|file| imports_directory(library).join(file)))
}

fn catalog(library: &Library, db: &Connection) -> CommandResult<Vec<BibleDatabase>> {
    let mut databases = Vec::new();
    let mut installed = HashSet::new();
    for entry in fs::read_dir(&library.bible_directory).map_err(message)? {
        let path = entry.map_err(message)?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("sqlite3") || !path.is_file() {
            continue;
        }
        let Some(id) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|id| valid_translation_id(id))
        else {
            continue;
        };
        if let Ok(name) = open_bible_file(&path).and_then(|source| {
            source.query_row("SELECT name FROM translations WHERE id = ?1", [id], |row| {
                row.get(0)
            })
        }) {
            installed.insert(id.to_ascii_lowercase());
            let bundled = BIBLES.iter().any(|(bundled, _, _, _)| *bundled == id);
            databases.push(BibleDatabase {
                translation: Translation {
                    id: id.into(),
                    name,
                },
                file_name: (!bundled).then(|| format!("{id}.sqlite3")),
                enabled: true,
            });
        }
    }
    let mut statement = db
        .prepare("SELECT translation, name, source_file, stored_file FROM bible_imports")
        .map_err(message)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                Translation {
                    id: row.get(0)?,
                    name: row.get(1)?,
                },
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(message)?;
    let directory = imports_directory(library);
    for row in rows {
        let (translation, file_name, stored_file) = row.map_err(message)?;
        if installed.insert(translation.id.to_ascii_lowercase())
            && directory.join(stored_file).is_file()
        {
            databases.push(BibleDatabase {
                translation,
                file_name: Some(file_name),
                enabled: true,
            });
        }
    }
    databases.sort_by(|a, b| {
        a.file_name
            .is_some()
            .cmp(&b.file_name.is_some())
            .then_with(|| a.translation.id.cmp(&b.translation.id))
    });
    Ok(databases)
}

fn read_preferences(db: &Connection) -> CommandResult<BiblePreferences> {
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

fn settings(mut databases: Vec<BibleDatabase>, preferences: &BiblePreferences) -> BibleSettings {
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
    let settings = settings(catalog(library, &db)?, &preferences);
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
                .map_err(|_| "Could not read the SQLite Bible database.")?;
            // Earlier files may lack optional book aliases and source metadata.
            target.execute_batch(BIBLE_SCHEMA).map_err(message)?;
        }
        _ => return Err("Choose a Bible JSON or SQLite file.".into()),
    }

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

struct PendingImport(Option<PathBuf>);

impl Drop for PendingImport {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}

fn import_file(library: &Library, source: &Path) -> CommandResult<BibleSettings> {
    let source_file = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid Bible file name.")?;
    let directory = imports_directory(library);
    fs::create_dir_all(&directory).map_err(message)?;
    let stored_file: String = library
        .db()?
        .query_row(
            "SELECT lower(hex(randomblob(16))) || '.sqlite3'",
            [],
            |row| row.get(0),
        )
        .map_err(message)?;
    let path = directory.join(&stored_file);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(message)?;
    let mut pending = PendingImport(Some(path.clone()));
    let mut target = Connection::open(path).map_err(message)?;
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
    let result = settings(
        catalog(library, &transaction)?,
        &read_preferences(&transaction)?,
    );
    transaction.commit().map_err(message)?;
    pending.0 = None;
    Ok(result)
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
        .set_title(title.as_deref().unwrap_or("Add a Bible database"))
        .add_filter(
            filter_name.as_deref().unwrap_or("Bible databases"),
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
    fn imports_new_editions_and_preserves_preferences_and_aliases() {
        let directory =
            std::env::temp_dir().join(format!("lighthouse-bible-test-{}", std::process::id()));
        let library = Library::open(&directory).unwrap();
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
        assert_eq!(imported.databases.len(), 3);
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

        let library = Library::open(&directory).unwrap();
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
