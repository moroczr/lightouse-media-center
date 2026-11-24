use super::{
    decode_background, image_url, message, studio_only, BackgroundImage, CommandResult, Library,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[derive(Serialize)]
struct SlideBackground {
    id: String,
    #[serde(flatten)]
    image: BackgroundImage,
}

#[derive(Serialize)]
struct SlideDefaults {
    text: Option<String>,
    scripture: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlideKind {
    Text,
    Scripture,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideSettings {
    default_themes: SlideDefaults,
    backgrounds: Vec<SlideBackground>,
}

pub(super) fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS slide_backgrounds (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            mime TEXT NOT NULL,
            data BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS slide_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            default_theme TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS slide_theme_defaults (
            kind TEXT PRIMARY KEY CHECK (kind IN ('text', 'scripture')),
            theme TEXT
        );
        INSERT OR IGNORE INTO slide_theme_defaults (kind, theme) VALUES
            ('text', (SELECT default_theme FROM slide_preferences WHERE id = 1)),
            ('scripture', (SELECT default_theme FROM slide_preferences WHERE id = 1));
        ",
    )
}

#[tauri::command]
pub fn load_slide_settings(
    window: WebviewWindow,
    library: State<'_, Library>,
) -> CommandResult<SlideSettings> {
    if window.label() != "kiosk" {
        studio_only(&window)?;
    }
    let db = library.db()?;
    let default_themes = db
        .query_row(
            "SELECT (SELECT theme FROM slide_theme_defaults WHERE kind = 'text'),
                    (SELECT theme FROM slide_theme_defaults WHERE kind = 'scripture')",
            [],
            |row| {
                Ok(SlideDefaults {
                    text: row.get(0)?,
                    scripture: row.get(1)?,
                })
            },
        )
        .map_err(message)?;
    let mut statement = db
        .prepare("SELECT id, name, mime, data FROM slide_backgrounds ORDER BY id")
        .map_err(message)?;
    let backgrounds = statement
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let mime: String = row.get(2)?;
            let data: Vec<u8> = row.get(3)?;
            Ok(SlideBackground {
                id: format!("image:{id}"),
                image: BackgroundImage {
                    name: row.get(1)?,
                    url: image_url(&mime, &data),
                },
            })
        })
        .map_err(message)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(message)?;
    Ok(SlideSettings {
        default_themes,
        backgrounds,
    })
}

#[tauri::command]
pub fn save_default_slide_theme(
    window: WebviewWindow,
    library: State<'_, Library>,
    kind: SlideKind,
    theme: Option<String>,
) -> CommandResult<()> {
    studio_only(&window)?;
    let db = library.db()?;
    if let Some(theme) = theme.as_deref() {
        let available = matches!(
            theme,
            "plain" | "twilight" | "violet" | "midnight" | "forest" | "ember" | "slate"
        ) || db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM slide_backgrounds WHERE 'image:' || id = ?1)",
                [&theme],
                |row| row.get::<_, bool>(0),
            )
            .map_err(message)?;
        if !available {
            return Err("The selected slide theme is unavailable.".into());
        }
    }
    let key = match kind {
        SlideKind::Text => "text",
        SlideKind::Scripture => "scripture",
    };
    db.execute(
        "INSERT INTO slide_theme_defaults (kind, theme) VALUES (?1, ?2)
         ON CONFLICT(kind) DO UPDATE SET theme = excluded.theme",
        params![key, theme],
    )
    .map_err(message)?;
    Ok(())
}

#[tauri::command]
pub fn add_slide_background(
    window: WebviewWindow,
    library: State<'_, Library>,
    app: AppHandle,
    background: BackgroundImage,
) -> CommandResult<()> {
    studio_only(&window)?;
    let (mime, data) = decode_background(&background.url)?;
    library
        .db()?
        .execute(
            "INSERT INTO slide_backgrounds (name, mime, data) VALUES (?1, ?2, ?3)",
            params![background.name, mime, data],
        )
        .map_err(message)?;
    let _ = app.emit_to("kiosk", "slide-settings-updated", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_the_shared_default_once_and_keeps_independent_resets() -> rusqlite::Result<()> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(
            "CREATE TABLE slide_preferences (id INTEGER PRIMARY KEY, default_theme TEXT NOT NULL);
             INSERT INTO slide_preferences VALUES (1, 'image:5');",
        )?;
        let read = |kind: &str| {
            db.query_row(
                "SELECT theme FROM slide_theme_defaults WHERE kind = ?1",
                [kind],
                |row| row.get::<_, Option<String>>(0),
            )
        };

        initialize(&db)?;
        assert_eq!(read("text")?.as_deref(), Some("image:5"));
        assert_eq!(read("scripture")?.as_deref(), Some("image:5"));

        db.execute(
            "UPDATE slide_theme_defaults SET theme = NULL WHERE kind = 'text'",
            [],
        )?;
        db.execute(
            "UPDATE slide_theme_defaults SET theme = 'forest' WHERE kind = 'scripture'",
            [],
        )?;
        initialize(&db)?;
        assert_eq!(read("text")?, None);
        assert_eq!(read("scripture")?.as_deref(), Some("forest"));
        Ok(())
    }
}
