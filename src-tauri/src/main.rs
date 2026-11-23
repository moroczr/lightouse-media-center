#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod library;
mod presentation;

use library::Library;
use presentation::Presentation;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            app.manage(Library::open(&directory)?);
            app.manage(Presentation::default());
            Ok(())
        })
        .on_window_event(presentation::window_event)
        .invoke_handler(tauri::generate_handler![
            library::load_project,
            library::save_project,
            library::load_kiosk_background,
            library::pick_kiosk_background,
            library::save_kiosk_background,
            library::translations,
            library::books,
            library::verses,
            library::pick_folder,
            library::pick_media,
            library::list_media,
            library::authorize_media,
            presentation::list_displays,
            presentation::kiosk_open,
            presentation::open_kiosk,
            presentation::close_kiosk,
            presentation::get_stage,
            presentation::present,
            presentation::set_blackout,
            presentation::control_playback,
            presentation::report_playback,
        ])
        .run(tauri::generate_context!())
        .expect("Nemesa Studio could not start");
}
