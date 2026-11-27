use super::{
    bible_settings::{
        catalog, language_folder, read_preferences, settings, shared_subfolder, validate_editions,
        BibleSettings,
    },
    message, open_bible_file, studio_only, valid_translation_id, CommandResult, Library,
};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Write, time::Duration};
use tauri::{Emitter, State, WebviewWindow};

const REPOSITORY: &str = "moroczr/verse-database";
const MAX_DATABASE_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Deserialize)]
struct Commit {
    sha: String,
}

#[derive(Deserialize)]
struct Branch {
    object: Commit,
}

#[derive(Deserialize)]
struct Manifest {
    version: u32,
    translations: Vec<CatalogEdition>,
}

#[derive(Deserialize, Serialize)]
pub struct CatalogEdition {
    id: String,
    name: String,
    language: String,
    collection: Option<String>,
    source: Option<String>,
    books: u32,
    verses: u32,
    bytes: u64,
    path: String,
    sha256: String,
}

#[derive(Serialize)]
pub struct BibleCatalog {
    revision: String,
    translations: Vec<CatalogEdition>,
}

#[derive(Clone, Serialize)]
struct DownloadProgress<'a> {
    id: &'a str,
    received: u64,
    total: u64,
}

fn client() -> CommandResult<Client> {
    Client::builder()
        .user_agent("Lighthouse-Media-Center")
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(message)
}

async fn fetch(client: &Client, url: String) -> CommandResult<Response> {
    client
        .get(url)
        .send()
        .await
        .and_then(Response::error_for_status)
        .map_err(message)
}

async fn read_json<T: serde::de::DeserializeOwned>(mut response: Response) -> CommandResult<T> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(message)? {
        if body.len() + chunk.len() > 1024 * 1024 {
            return Err("The Bible catalog is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(message)
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn raw_url(revision: &str, path: &str) -> String {
    format!("https://raw.githubusercontent.com/{REPOSITORY}/{revision}/{path}")
}

fn validate_manifest(manifest: Manifest) -> CommandResult<Vec<CatalogEdition>> {
    let mut ids = HashSet::new();
    if manifest.version != 1
        || manifest.translations.iter().any(|edition| {
            !valid_translation_id(&edition.id)
                || !ids.insert(edition.id.to_ascii_lowercase())
                || edition.name.trim().is_empty()
                || !language_folder(&edition.language)
                || edition.path != format!("{}/{}.sqlite3", edition.language, edition.id)
                || !(1..=MAX_DATABASE_BYTES).contains(&edition.bytes)
                || edition.books == 0
                || edition.verses == 0
                || !valid_hex(&edition.sha256, 64)
        })
    {
        return Err("The Bible catalog has an unsupported format.".into());
    }
    Ok(manifest.translations)
}

async fn manifest(client: &Client, revision: &str) -> CommandResult<Vec<CatalogEdition>> {
    if !valid_hex(revision, 40) {
        return Err("Invalid Bible catalog revision.".into());
    }
    validate_manifest(read_json(fetch(client, raw_url(revision, "catalog.json")).await?).await?)
}

#[tauri::command]
pub async fn fetch_bible_catalog(window: WebviewWindow) -> CommandResult<BibleCatalog> {
    studio_only(&window)?;
    load_catalog(&client()?).await
}

async fn load_catalog(client: &Client) -> CommandResult<BibleCatalog> {
    let branch: Branch = read_json(
        fetch(
            client,
            format!("https://api.github.com/repos/{REPOSITORY}/git/ref/heads/main"),
        )
        .await?,
    )
    .await?;
    let revision = branch.object.sha;
    let translations = manifest(client, &revision).await?;
    Ok(BibleCatalog {
        revision,
        translations,
    })
}

fn validate_download(path: &std::path::Path, edition: &CatalogEdition) -> CommandResult<()> {
    let source = open_bible_file(path).map_err(message)?;
    let integrity: String = source
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(message)?;
    let has_invalid_reference: bool = source
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |row| row.get(0),
        )
        .map_err(message)?;
    let editions = validate_editions(&source)?;
    let (books, verses): (u32, u32) = source
        .query_row(
            "SELECT (SELECT count(*) FROM books WHERE translation = ?1),
                (SELECT count(*) FROM verses WHERE translation = ?1)",
            [&edition.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(message)?;
    if integrity != "ok"
        || has_invalid_reference
        || editions.len() != 1
        || editions[0].id != edition.id
        || editions[0].name != edition.name
        || (books, verses) != (edition.books, edition.verses)
    {
        return Err("The downloaded translation is invalid.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn download_bible(
    window: WebviewWindow,
    library: State<'_, Library>,
    revision: String,
    id: String,
) -> CommandResult<BibleSettings> {
    studio_only(&window)?;
    install(&library, &client()?, &revision, &id, |progress| {
        let _ = window.emit("bible-download-progress", progress);
    })
    .await
}

async fn install(
    library: &Library,
    client: &Client,
    revision: &str,
    id: &str,
    on_progress: impl Fn(DownloadProgress<'_>),
) -> CommandResult<BibleSettings> {
    let edition = manifest(client, revision)
        .await?
        .into_iter()
        .find(|edition| edition.id == id)
        .ok_or("The requested edition is unavailable.")?;
    {
        let db = library.db()?;
        let installed = catalog(library, &db)?;
        if installed
            .iter()
            .any(|item| item.translation.id.eq_ignore_ascii_case(id))
        {
            return Ok(settings(installed, &read_preferences(&db)?));
        }
    }
    let directory = shared_subfolder(&library.bible_directory, &edition.language)?;
    let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(message)?;
    let mut response = fetch(client, raw_url(revision, &edition.path)).await?;
    let mut digest = Sha256::new();
    let mut received = 0;
    let mut progress = 0;
    while let Some(chunk) = response.chunk().await.map_err(message)? {
        received += chunk.len() as u64;
        if received > edition.bytes {
            return Err("The download did not match the Bible catalog.".into());
        }
        digest.update(&chunk);
        temporary.write_all(&chunk).map_err(message)?;
        let step = received * 20 / edition.bytes;
        if step != progress {
            progress = step;
            on_progress(DownloadProgress {
                id,
                received,
                total: edition.bytes,
            });
        }
    }
    if received != edition.bytes
        || !format!("{:x}", digest.finalize()).eq_ignore_ascii_case(&edition.sha256)
    {
        return Err("The download did not match the Bible catalog.".into());
    }
    temporary.as_file().sync_all().map_err(message)?;
    validate_download(temporary.path(), &edition)?;

    // Serialize the final duplicate check and install with local imports.
    let db = library.db()?;
    let installed = catalog(library, &db)?;
    if !installed
        .iter()
        .any(|item| item.translation.id.eq_ignore_ascii_case(id))
    {
        temporary
            .persist_noclobber(directory.join(format!("{id}.sqlite3")))
            .map_err(message)?;
    }
    Ok(settings(catalog(library, &db)?, &read_preferences(&db)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_requires_safe_paths_and_unique_translation_ids() {
        fn edition(id: &str, path: &str) -> CatalogEdition {
            CatalogEdition {
                id: id.into(),
                name: "Example Bible".into(),
                language: "hu".into(),
                collection: None,
                source: None,
                books: 1,
                verses: 1,
                bytes: 4096,
                path: path.into(),
                sha256: "0".repeat(64),
            }
        }
        let manifest = |translations| Manifest {
            version: 1,
            translations,
        };
        assert!(validate_manifest(manifest(vec![edition("HU", "hu/HU.sqlite3")])).is_ok());
        assert!(validate_manifest(manifest(vec![edition("HU", "../HU.sqlite3")])).is_err());
        assert!(validate_manifest(manifest(vec![
            edition("HU", "hu/HU.sqlite3"),
            edition("hu", "hu/hu.sqlite3"),
        ]))
        .is_err());
    }

    #[test]
    #[ignore = "downloads an edition from the public GitHub catalog"]
    fn installs_an_edition_from_github_and_reopens_it_offline() {
        tauri::async_runtime::block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let shared = directory.path().join("shared");
            let app = directory.path().join("app");
            let library = Library::open(&app, shared.clone()).unwrap();
            let client = client().unwrap();
            let catalog = load_catalog(&client).await.unwrap();
            let remote = catalog
                .translations
                .first()
                .expect("at least one published edition");
            let installed = install(&library, &client, &catalog.revision, &remote.id, |_| {})
                .await
                .unwrap();
            assert_eq!(installed.default_id.as_deref(), Some(remote.id.as_str()));
            assert!(shared.join(&remote.path).is_file());
            assert!(!app.join("bibles").exists());
            drop(library);
            let library = Library::open(&app, shared).unwrap();
            let db = library.open_bible(&remote.id).unwrap();
            assert!(!super::super::read_books(&db, &remote.id)
                .unwrap()
                .is_empty());
        });
    }
}
