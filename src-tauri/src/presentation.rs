use crate::library::studio_only;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use tauri::webview::Color;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

type CommandResult<T> = Result<T, String>;

#[derive(Default)]
pub struct Presentation(Mutex<Stage>);

#[derive(Clone, Serialize, Deserialize)]
pub struct Cue {
    id: String,
    title: String,
    #[serde(flatten)]
    content: Content,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Content {
    Text {
        text: String,
        theme: String,
    },
    Scripture {
        text: String,
        theme: String,
        caption: String,
    },
    Video {
        url: String,
    },
    Audio {
        url: String,
    },
}

impl Cue {
    fn is_media(&self) -> bool {
        matches!(self.content, Content::Video { .. } | Content::Audio { .. })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    revision: u64,
    playback_revision: u64,
    seek: Option<PlaybackSeek>,
    cue: Option<Cue>,
    blackout: bool,
    playing: bool,
    position: f64,
    duration: f64,
    volume: f64,
    muted: bool,
    error: Option<String>,
}

impl Default for Stage {
    fn default() -> Self {
        Self {
            revision: 0,
            playback_revision: 0,
            seek: None,
            cue: None,
            blackout: false,
            playing: false,
            position: 0.0,
            duration: 0.0,
            volume: 1.0,
            muted: false,
            error: None,
        }
    }
}

#[derive(Clone, Serialize)]
struct PlaybackSeek {
    revision: u64,
    position: f64,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PlaybackAction {
    Play,
    Pause,
    Stop,
    Seek { position: f64 },
    Skip { seconds: f64 },
    Volume { volume: f64 },
    Mute { muted: bool },
}

#[derive(Deserialize)]
pub struct PlaybackReport {
    position: f64,
    duration: f64,
    ended: bool,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct Display {
    id: String,
    name: String,
    width: u32,
    height: u32,
    studio: bool,
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl Presentation {
    fn stage(&self) -> CommandResult<MutexGuard<'_, Stage>> {
        self.0
            .lock()
            .map_err(|_| "The presentation session is unavailable.".into())
    }

    fn update(
        &self,
        app: &AppHandle,
        mutate: impl FnOnce(&mut Stage) -> bool,
    ) -> CommandResult<Stage> {
        let mut stage = self.stage()?;
        if mutate(&mut stage) {
            app.emit("stage-updated", &*stage).map_err(message)?;
        }
        Ok(stage.clone())
    }
}

fn monitor_id(monitor: &Monitor) -> String {
    let position = monitor.position();
    format!(
        "{}:{}:{}",
        monitor.name().map_or("", String::as_str),
        position.x,
        position.y
    )
}

#[cfg(target_os = "macos")]
fn macos_display_names() -> std::collections::HashMap<PhysicalPosition<i32>, String> {
    use core_graphics::display::CGDisplay;
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{ns_string, NSNumber};

    let Some(main_thread) = MainThreadMarker::new() else {
        return Default::default();
    };

    NSScreen::screens(main_thread)
        .iter()
        .filter_map(|screen| {
            let number = screen
                .deviceDescription()
                .objectForKey(ns_string!("NSScreenNumber"))?
                .downcast::<NSNumber>()
                .ok()?;
            let display = CGDisplay::new(number.unsignedIntValue());
            let name = if display.is_builtin() {
                "Built-in Display".into()
            } else if objc2::available!(macos = 10.15) {
                screen.localizedName().to_string()
            } else {
                return None;
            };

            // Match Tauri's scaled Core Graphics display origin while keeping saved IDs intact.
            let origin = display.bounds().origin;
            let position = PhysicalPosition::from_logical::<_, f64>(
                (origin.x, origin.y),
                screen.backingScaleFactor(),
            );
            Some((position, name))
        })
        .collect()
}

#[tauri::command]
pub async fn list_displays(window: WebviewWindow, app: AppHandle) -> CommandResult<Vec<Display>> {
    studio_only(&window)?;
    let studio = window
        .current_monitor()
        .map_err(message)?
        .as_ref()
        .map(monitor_id);
    let monitors = app.available_monitors().map_err(message)?;

    #[cfg(target_os = "macos")]
    let names = {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.try_send(macos_display_names());
        })
        .map_err(message)?;
        receiver.recv().await.unwrap_or_default()
    };

    Ok(monitors
        .iter()
        .map(|monitor| {
            let id = monitor_id(monitor);
            let name = monitor.name().cloned();
            #[cfg(target_os = "macos")]
            let name = names.get(monitor.position()).cloned().or(name);
            Display {
                studio: studio.as_ref() == Some(&id),
                id,
                name: name.unwrap_or_else(|| "Unnamed display".into()),
                width: monitor.size().width,
                height: monitor.size().height,
            }
        })
        .collect())
}

#[tauri::command]
pub fn kiosk_open(app: AppHandle) -> bool {
    app.get_webview_window("kiosk").is_some()
}

fn place_windowed_kiosk(kiosk: &WebviewWindow, monitor: &Monitor) -> tauri::Result<()> {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = (area.size.width / 2)
        .min(area.size.height * 2 / 3)
        .min((720.0 * scale).round() as u32);
    kiosk.set_size(PhysicalSize::new(width, width * 9 / 16))?;

    let size = kiosk.outer_size()?;
    let margin = (16.0 * scale).round() as u32;
    kiosk.set_position(PhysicalPosition::new(
        area.position.x + area.size.width.saturating_sub(size.width + margin) as i32,
        area.position.y + area.size.height.saturating_sub(size.height + margin) as i32,
    ))
}

#[tauri::command]
pub async fn open_kiosk(
    window: WebviewWindow,
    app: AppHandle,
    display_id: String,
) -> CommandResult<()> {
    studio_only(&window)?;
    if kiosk_open(app.clone()) {
        return Ok(());
    }
    let monitors = app.available_monitors().map_err(message)?;
    let windowed = monitors.len() == 1;
    let monitor = monitors
        .iter()
        .find(|monitor| monitor_id(monitor) == display_id)
        .ok_or("The selected display is no longer connected.")?;
    let page = if windowed {
        "index.html#kiosk-window"
    } else {
        "index.html#kiosk"
    };
    let builder = WebviewWindowBuilder::new(&app, "kiosk", WebviewUrl::App(page.into()))
        .title("Nemesa Kiosk")
        .visible(false)
        .focused(false)
        .decorations(windowed)
        .always_on_top(!windowed)
        .skip_taskbar(!windowed)
        .background_color(Color(0, 0, 0, 255));

    #[cfg(target_os = "macos")]
    let builder = if windowed {
        builder
    } else {
        // AppKit places windows in logical points. Use the target display's scale
        // so Kiosk starts there even when Studio is on a differently scaled display.
        let scale = monitor.scale_factor();
        let position = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        builder
            .position(position.x, position.y)
            .inner_size(size.width, size.height)
    };

    let kiosk = builder.build().map_err(message)?;
    let layout = || -> CommandResult<()> {
        if windowed {
            place_windowed_kiosk(&kiosk, monitor).map_err(message)?;
        } else {
            #[cfg(target_os = "macos")]
            if !kiosk
                .current_monitor()
                .map_err(message)?
                .as_ref()
                .is_some_and(|current| monitor_id(current) == display_id)
            {
                return Err("Could not place Kiosk on the selected display.".into());
            }

            #[cfg(not(target_os = "macos"))]
            {
                kiosk.set_position(*monitor.position()).map_err(message)?;
                kiosk.set_size(*monitor.size()).map_err(message)?;
            }
        }
        kiosk.show().map_err(message)?;

        if !windowed {
            #[cfg(target_os = "macos")]
            kiosk.set_simple_fullscreen(true).map_err(message)?;

            #[cfg(not(target_os = "macos"))]
            {
                let position = monitor.position();
                kiosk
                    .set_fullscreen_on_monitor(PhysicalPosition::new(
                        f64::from(position.x),
                        f64::from(position.y),
                    ))
                    .map_err(message)?;
            }
        }

        if windowed
            || window
                .current_monitor()
                .map_err(message)?
                .as_ref()
                .is_some_and(|studio| monitor_id(studio) == display_id)
        {
            kiosk.set_focus().map_err(message)?;
            kiosk.as_ref().set_focus().map_err(message)?;
        }
        Ok(())
    };
    if let Err(error) = layout() {
        let _ = kiosk.destroy();
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn close_kiosk(window: WebviewWindow, app: AppHandle) -> CommandResult<()> {
    if window.label() != "kiosk" {
        studio_only(&window)?;
    }
    if let Some(kiosk) = app.get_webview_window("kiosk") {
        kiosk.destroy().map_err(message)?;
    }
    Ok(())
}

pub fn window_event(window: &Window, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    let app = window.app_handle();
    match window.label() {
        "studio" => {
            if let Some(kiosk) = app.get_webview_window("kiosk") {
                let _ = kiosk.destroy();
            }
        }
        "kiosk" => {
            let _ = app.emit_to("studio", "kiosk-closed", ());
            if let Some(presentation) = app.try_state::<Presentation>() {
                let _ = presentation.update(app, |stage| {
                    let playing = stage.playing;
                    stage.playing = false;
                    playing
                });
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn get_stage(presentation: State<'_, Presentation>) -> CommandResult<Stage> {
    Ok(presentation.stage()?.clone())
}

#[tauri::command]
pub fn present(
    window: WebviewWindow,
    app: AppHandle,
    presentation: State<'_, Presentation>,
    cue: Option<Cue>,
) -> CommandResult<Stage> {
    studio_only(&window)?;
    presentation.update(&app, |stage| {
        *stage = Stage {
            revision: stage.revision + 1,
            playing: cue.as_ref().is_some_and(Cue::is_media),
            cue,
            blackout: stage.blackout,
            volume: stage.volume,
            muted: stage.muted,
            ..Stage::default()
        };
        true
    })
}

#[tauri::command]
pub fn set_blackout(
    window: WebviewWindow,
    app: AppHandle,
    presentation: State<'_, Presentation>,
    blackout: bool,
) -> CommandResult<Stage> {
    studio_only(&window)?;
    presentation.update(&app, |stage| {
        stage.blackout = blackout;
        true
    })
}

#[tauri::command]
pub fn control_playback(
    window: WebviewWindow,
    app: AppHandle,
    presentation: State<'_, Presentation>,
    revision: u64,
    action: PlaybackAction,
) -> CommandResult<Stage> {
    studio_only(&window)?;
    presentation.update(&app, |stage| {
        let seek = match action {
            PlaybackAction::Volume { volume } => {
                stage.volume = volume.clamp(0.0, 1.0);
                return true;
            }
            PlaybackAction::Mute { muted } => {
                stage.muted = muted;
                return true;
            }
            _ if stage.revision != revision || !stage.cue.as_ref().is_some_and(Cue::is_media) => {
                return false;
            }
            PlaybackAction::Seek { .. } | PlaybackAction::Skip { .. } if stage.duration <= 0.0 => {
                return false;
            }
            PlaybackAction::Play => {
                stage.playing = true;
                stage.error = None;
                (stage.duration > 0.0 && stage.position >= stage.duration).then_some(0.0)
            }
            PlaybackAction::Pause => {
                stage.playing = false;
                None
            }
            PlaybackAction::Stop => {
                stage.playing = false;
                Some(0.0)
            }
            PlaybackAction::Seek { position } => Some(position),
            PlaybackAction::Skip { seconds } => Some(stage.position + seconds),
        };
        stage.playback_revision += 1;
        if let Some(position) = seek {
            stage.position = position.clamp(0.0, stage.duration);
            stage.seek = Some(PlaybackSeek {
                revision: stage.playback_revision,
                position: stage.position,
            });
        }
        true
    })
}

#[tauri::command]
pub fn report_playback(
    window: WebviewWindow,
    app: AppHandle,
    presentation: State<'_, Presentation>,
    revision: u64,
    playback_revision: u64,
    report: PlaybackReport,
) -> CommandResult<()> {
    if window.label() != "kiosk" {
        return Ok(());
    }
    presentation.update(&app, |stage| {
        if stage.revision != revision
            || stage.playback_revision != playback_revision
            || !stage.cue.as_ref().is_some_and(Cue::is_media)
        {
            return false;
        }
        stage.position = report.position.max(0.0);
        stage.duration = report.duration.max(0.0);
        if report.ended || report.error.is_some() {
            stage.playing = false;
        }
        if report.error.is_some() {
            stage.error = report.error;
        }
        true
    })?;
    Ok(())
}
