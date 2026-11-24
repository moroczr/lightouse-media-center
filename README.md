# Lighthouse Media Center

Lighthouse Media Center is an offline presentation app for Windows and macOS. Studio controls the show and Kiosk renders it full-screen on the chosen audience display.

## Run from source

Install Node.js, npm, the stable Rust toolchain, and the [Tauri desktop prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm ci
npm run tauri dev
```

To package the app on the current platform, run `npm run tauri build`. On macOS, `npm run tauri build -- --bundles app` creates an application bundle. On Windows, `npm run tauri build -- --bundles nsis` creates a setup executable. Tauri writes bundles under `src-tauri/target/`.

`npm run dev` offers a browser preview for frontend development. It opens Kiosk as a popup. Browser media selections are available for the current session. Use the desktop app for full-screen monitor placement and persistent media sources.

## Present

1. Select an audience display and click **Launch Kiosk**. With one display, Kiosk opens in a movable, resizable window. With multiple displays, it opens full-screen on the selected display.
2. Choose a playlist and click a cue to see it in **Next up**. **Previous** and **Next** move the queued selection without changing the current audience output.
3. Click **Go live** to take the queued cue live and queue the next item. Nested playlists play in order, depth first. Groups can be expanded or collapsed independently of that order.
4. To show a one-off item, open **Add Media**, **Bible lookup**, or **Text slide** and select **Send to Kiosk**. The queued playlist item stays in place.
5. When video or audio is live, use the controls under **Live output** to play, pause, stop and rewind, seek, or skip 10 seconds in either direction. The vertical Kiosk volume and mute controls beside **Next up** are available before and during playback, including when a text or Bible verse cue is live.
6. **Blackout** hides the audience picture while audio continues. **Clear live output** removes the current cue. Press **Escape** in the Kiosk to close it.

Use the **Kiosk background** image button beside **Launch Kiosk** to choose a PNG, JPEG, or WebP image. Studio saves a copy and shows it whenever no cue is live, including after a restart. **Remove image** restores the black idle screen.

Use the sidebar toggle at the top left to hide or restore the playlists and library.

Add folders under **Media sources**, then open **Add Media** to search across those folders and their subfolders. Switch between list and tile views, filter by **Movies** or **Audio**, and select a file to add to the playlist or send to Kiosk. Use **Open file** for a file outside your sources. The app keeps references to the original files. For cross-platform playback, start with H.264/AAC video in MP4 and MP3 or WAV audio. Additional codecs depend on the system WebView.

Playlists and settings are saved locally in SQLite. In **Bible lookup**, choose a translation and type a reference such as `1 Pet 2:24`. Book, chapter, and verse suggestions narrow as you type. A single match fills in automatically. Use Backspace to remove a segment. The results highlight the searched verse and fill the panel with nearby verses. Click a verse or use the up and down arrows to choose which one to cue. The list scrolls as the selection moves past the visible verses. Switch to **Verse text** to search by remembered words or phrases. Search ranks exact phrases first and can find partial words and common typos. The app includes the complete 66-book editions of the [World English Bible](https://ebible.org/find/show.php?id=engwebp) and the [World English Bible British Edition](https://ebible.org/find/show.php?id=engwebpb), sourced from the eBible.org public-domain verse-per-line archives. Both are available offline.
