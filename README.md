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
2. Choose a playlist and click a cue in **Cue List** to see it in **Next up**. **Previous** and **Next** move the queued selection without changing the current audience output.
3. Click **Go live** to take the queued cue live and queue the next item. Nested playlists play in order, depth first. Groups can be expanded or collapsed independently of that order.
4. Use the **Media**, **Bible lookup**, and **Text slides** tabs to prepare cues. Select **Add to playlist** to save a cue or **Send to Kiosk** to present it directly while keeping your place in the cue list. Press **Ctrl+M**, **Ctrl+B**, or **Ctrl+T** to open those tabs.
5. When video or audio is live, use the controls under **Live output** to play, pause, stop and rewind, seek, or skip 10 seconds in either direction. For a Bible verse, **Previous verse** and **Next verse** under **Live output** change the displayed verse without advancing the playlist. The vertical Kiosk volume and mute controls beside **Next up** are available before and during playback, including when a text or Bible verse cue is live.
6. Click **Blackout** or press **B** in Studio. It hides the audience picture while audio continues. Press **Escape** in the Kiosk to close it.

Use the **Kiosk background** image button beside **Launch Kiosk** to choose a PNG, JPEG, or WebP image. Studio saves a copy and shows it whenever no cue is live, including after a restart. **Remove image** restores the black idle screen.

Use the sidebar toggle at the top left to hide or restore the playlists and library.

Under **Slides** in the sidebar, choose **New library** and enter a name such as `Worships`. Open a library, choose **New text slide**, and select **Save to library**. The caption also names the slide. If it is blank, the first text entry supplies the caption and its first line supplies the name. Select a saved set to edit it, add a copy to any playlist, or send it directly to Kiosk. The **Previous slide** and **Next slide** buttons under **Live output** navigate a set sent directly. Open the **Text slides** tab for an overview of all libraries or choose **One-off text slide** to add or send text for a single use.

Open **Settings → Slides** to add PNG, JPEG, or WebP backgrounds and set separate default themes for new text slides and Bible verse cues. Built-in themes and imported images are available in each slide’s **Background** picker. Changing the default only affects new slides.

Add folders under **Media sources**, then open the **Media** tab to search across those folders and their subfolders. Switch between list and tile views, filter by **Movies** or **Audio**, and select a file to add to the playlist or send to Kiosk. Use **Open file** for a file outside your sources. The app keeps references to the original files. For cross-platform playback, start with H.264/AAC video in MP4 and MP3 or WAV audio. Additional codecs depend on the system WebView.

Change the interface language under **Settings → General → Language**. Choose **English** or **Magyar** (Hungarian). The app remembers your choice.

Playlists and Bible settings are saved locally in SQLite. In **Bible lookup**, choose a translation and type a reference such as `1 Pet 2:24`. Book, chapter, and verse suggestions narrow as you type. A single match fills in automatically. Use Backspace to remove a segment. The results highlight the searched verse and fill the panel with nearby verses. Click a verse or use the up and down arrows to choose which one to cue. The list scrolls as the selection moves past the visible verses. Switch to **Verse text** to search by remembered words or phrases. Search ranks exact phrases first and can find partial words and common typos. The app includes the complete 66-book editions of the [World English Bible](https://ebible.org/find/show.php?id=engwebp) and the [World English Bible British Edition](https://ebible.org/find/show.php?id=engwebpb), sourced from the eBible.org public-domain verse-per-line archives. Both are available offline.

Open the gear beside **Launch Kiosk** and select **Bible** to add databases, choose which editions appear in **Bible lookup**, and set the default for new lookups. Changes save automatically. Existing cues keep their original editions when those editions are hidden. The desktop app accepts SQLite files using the shared Bible schema and Bible JSON files using the structure in `public/bible-WEBP.json`. It copies imported databases into app storage and imports new editions from files containing multiple translations. The browser preview accepts JSON imports.

The desktop app stores bundled and manually installed Bible editions as separate SQLite files in the `bibles` subdirectory of its app data directory. The English editions are seeded on first launch. The local Hungarian editions are `H_Karoli_snc.sqlite3` and `H_rev_Karoli_KSZE.sqlite3`. Each file uses the [shared Bible schema](src-tauri/bible/schema.sql) and includes its own book names, aliases, chapter counts, verses, and source metadata. The app reads these files for reference lookup, verse-text search, and live verse navigation. When preparing editions from Biblia-json-xml, apply the [Hungarian book names SQL](src-tauri/bible/hungarian-book-names.sql) to the generated SQLite files.
