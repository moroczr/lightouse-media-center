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

1. At the top of the left pane, select an audience display and click **Launch Kiosk**. With one display, Kiosk opens in a movable, resizable window. With multiple displays, it opens full-screen on the selected display.
2. Choose a playlist and click a cue in **Cue List** to see it in **Preview**. **Previous** and **Next** beside the tabs move the queued selection without changing the current audience output.
3. Click **Go live** to take the queued cue live and queue the next item. Nested playlists play in order, depth first. Groups can be expanded or collapsed independently of that order.
4. Open **Media**, **Bible lookup**, or **Slides** and type in the focused search field. Press **↓** to enter the results. Double-click a folder, library, Bible book, chapter, or slide set to open it, or select it and press **Enter**. Select a file, verse, or slide to preview it in **Preview**. Media searches all libraries from the top level, or the current library and its subfolders when a library is open. Drag a result onto **Preview** to preview it or onto **Live** to present it. Use the arrow keys to select a result and press **Ctrl+Enter** to send it live. You can also double-click the result, click **Go live**, or use its **Send to Kiosk** icon without advancing the cue list. Open **Add cue** in **Cue List** to browse media, saved slides, or Bible verses and add a cue to the current playlist. Use **Add cue here** in a nested playlist to add there. Press **Ctrl+M**, **Ctrl+B**, or **Ctrl+T** to open those tabs.
5. When video or audio is live, use the playback controls beneath the previews to play, pause, stop and rewind, seek, or skip 10 seconds in either direction. For a Bible verse, **Previous verse** and **Next verse** beneath the previews change the displayed verse without advancing the playlist. The vertical Kiosk volume and mute controls beside **Preview** are available before and during playback, including when a text or Bible verse cue is live.
6. Click **Blackout** in the bottom-right corner of **Live**, or press **Ctrl+Shift+B** in Studio. The audience sees the configured Kiosk background, or a black screen if no image is set. Audio continues during Blackout. Press **Escape** in the Kiosk to close it.

Use the **Kiosk background** image button at the bottom of the left pane to choose a PNG, JPEG, or WebP image. Studio saves a copy and shows it behind audio cues, when no cue is live, and during Blackout. During audio playback, animated equalizer bars appear over the image. **Remove image** restores the black background.

Use the sidebar toggle at the top left to collapse or expand the playlists. Kiosk controls and Settings stay available in the collapsed pane. Studio opens with an empty cue list. Use **Add cue** to build and present a draft. Choose **Save** and enter a name to keep it in the sidebar. Open a saved playlist to edit it, then choose **Save** and confirm to update it. The pencil in **Cue List** edits its name. **Remove all** clears the working list, and **New playlist** starts another draft. The sidebar trash button deletes a saved playlist.

In **Slides**, choose **New library**, double-click it, and choose **New text slide**. The caption names the slide. If you leave it blank, the first text entry supplies the caption and its first line supplies the name. Switch between **List view** and **Mosaic view** to browse saved slides. Each library has rename and delete buttons. Double-click a saved slide name to open its individual slides. Click an individual slide to preview it in **Preview**, or double-click it to send it to **Live**. The edit and delete buttons apply to the whole set. Deleting a library also deletes its saved slides and sublibraries. The **Previous slide** and **Next slide** buttons beneath the previews navigate a set sent directly. To create a one-off cue, open **Add cue** in **Cue List** and select **One-off text slide**.

Choose a background for all text slides from the **Background** dropdown in **Slides**. It shows thumbnails for built-in themes and imported images. Open **Settings → Slides** to add PNG, JPEG, or WebP backgrounds and set the default theme for new Bible verse cues.

In the **Media** tab, choose **Add folder** to add a source. Double-click a source to browse it. Use the remove button beside the open folder’s name to stop using it as a source. Each source shows only supported audio and video from that folder and its subfolders. Switch between list and tile views, filter by **Movies** or **Audio**, and use the icon beside a file to send it to Kiosk. Use **Open file** for a file outside your sources. The app keeps references to the original files. For cross-platform playback, start with H.264/AAC video in MP4 and MP3 or WAV audio. Additional codecs depend on the system WebView.

Change the interface language under **Settings → General → Language**. Choose **English** or **Magyar** (Hungarian). The app remembers your choice.

Playlists and Bible settings are saved locally. In **Bible lookup**, choose a translation and type a reference such as `1 Pet 2:24`. Book, chapter, and verse suggestions narrow as you type. A single match fills in automatically. Use Backspace to remove a segment. The results highlight the searched verse and fill the panel with nearby verses. Click a verse or use the up and down arrows to choose which one to cue. The list scrolls as the selection moves past the visible verses. In the search field, type `/` to start a fresh verse-text search or `@` to start a fresh reference lookup. Both shortcuts clear the field and keep it focused. Search ranks exact phrases first and can find partial words and common typos.

Open **Settings → Bible → Available translations** to choose which translations appear in **Bible lookup** and set the default. Under **Download translations**, use the download icon beside a translation in the [GitHub catalog](https://github.com/moroczr/verse-database) to make it available offline. Downloaded translations have a remove icon that deletes the local copy. Saved cues keep their translation IDs. Bible lookup and translation downloads require the desktop app.
