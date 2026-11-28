"""Exercise the installed app on a disposable Windows desktop."""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen

import imageio_ffmpeg
import win32api
import win32gui
from playwright.sync_api import expect, sync_playwright
from pywinauto import Desktop


def create_clip(folder):
    clip = folder / "Próba clip.mp4"
    subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440", "-t", "60",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart", str(clip),
    ], check=True)
    return clip


def wait_for_webview(app, endpoint):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if app.poll() is not None:
            raise RuntimeError(f"Studio exited during startup with code {app.returncode}")
        try:
            with urlopen(f"{endpoint}/json/list", timeout=1) as response:
                if any(t["type"] == "page" for t in json.load(response)):
                    return
        except (URLError, TimeoutError):
            pass
        time.sleep(0.25)
    raise TimeoutError("Studio did not expose a WebView2 page within 45 seconds")


def button(page, name):
    return page.get_by_role("button", name=name, exact=True)


def rehearse(context, studio, pid, clip):
    launch = button(studio, "Launch Kiosk")
    expect(launch).to_be_enabled()
    display = studio.get_by_role("combobox", name="Kiosk display")
    options = display.locator("option")
    multiple_displays = options.count() > 1
    if multiple_displays:
        target = options.filter(has_not_text="(Studio)").first.get_attribute("value")
        display.select_option(value=target)
    selected_device = display.input_value().rsplit(":", 2)[0]

    with context.expect_page(timeout=30000) as opened:
        launch.click()
    kiosk = opened.value
    expect(kiosk.locator(".audience--output")).to_be_visible()

    # Compare the native window to the display chosen in Studio.
    expect(button(studio, "Close Kiosk")).to_be_enabled()
    window = Desktop(backend="win32").window(process=pid, title="Lighthouse Media Center Kiosk")
    window.wait("visible", timeout=15)
    monitor = win32api.GetMonitorInfo(win32api.MonitorFromWindow(window.handle))
    assert monitor["Device"] == selected_device, (selected_device, monitor)
    bounds = win32gui.GetWindowRect(window.handle)
    if multiple_displays:
        assert bounds == monitor["Monitor"], (bounds, monitor)
        print("Verified full-screen Kiosk on the selected external display.")
    else:
        assert bounds != monitor["Monitor"], (bounds, monitor)
        print("Verified windowed Kiosk on the single runner display.")

    button(studio, "Add cue").click()
    button(studio, "One-off text slide").click()
    studio.get_by_label("Caption (optional)").fill("Welcome")
    studio.get_by_label("Slide 1", exact=True).fill("Windows rehearsal")
    button(studio, "Add to playlist").click()
    studio.get_by_title("Cue Welcome (double-click to go live)", exact=True).dblclick()
    expect(kiosk.get_by_text("Windows rehearsal", exact=True)).to_be_visible()

    studio.get_by_role("tab", name="Media", exact=True).click()
    button(studio, "Open file").click()
    dialog = Desktop(backend="uia").window(process=pid, class_name="#32770")
    dialog.wait("visible", timeout=15)
    filename = dialog.child_window(title="File name:", control_type="Edit")
    filename.set_edit_text(str(clip))
    filename.type_keys("{ENTER}")
    button(studio, f"Send {clip.name} to Kiosk").click()
    kiosk.wait_for_function("""() => {
        const v = document.querySelector('video');
        return v && !v.error && v.videoWidth === 160 && v.currentTime > 0.3 && !v.paused;
    }""")
    button(studio, "Pause media").click()
    expect(kiosk.locator("video")).to_have_js_property("paused", True)
    paused = kiosk.locator("video").evaluate("v => v.currentTime")
    button(studio, "Forward 10 seconds").click()
    kiosk.wait_for_function("t => document.querySelector('video').currentTime >= t + 9",
                            arg=paused)
    button(studio, "Play media").click()
    button(studio, "Blackout").click()
    overlay = kiosk.locator(".slide-blackout")
    expect(overlay).to_be_visible()
    blacked_out = kiosk.locator("video").evaluate("v => v.currentTime")
    kiosk.wait_for_function("t => document.querySelector('video').currentTime > t + 0.5",
                            arg=blacked_out)
    button(studio, "Blackout").click()
    expect(overlay).to_have_count(0)
    with kiosk.expect_event("close"):
        kiosk.keyboard.press("Escape")
    expect(button(studio, "Launch Kiosk")).to_be_enabled()


def run(executable):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp, sync_playwright() as pw:
        folder = Path(temp)
        clip = create_clip(folder)
        with socket.socket() as available:
            available.bind(("127.0.0.1", 0))
            port = available.getsockname()[1]
        endpoint = f"http://127.0.0.1:{port}"
        env = {**os.environ, "WEBVIEW2_USER_DATA_FOLDER": str(folder / "webview"),
               "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={port}"}
        app = subprocess.Popen([str(executable)], env=env)
        try:
            wait_for_webview(app, endpoint)
            browser = pw.chromium.connect_over_cdp(endpoint)
            context = browser.contexts[0]
            context.set_default_timeout(15000)
            context.tracing.start(screenshots=True, snapshots=True)
            try:
                rehearse(context, context.pages[0], app.pid, clip)
            except Exception:
                context.tracing.stop(path="windows-presentation-trace.zip")
                raise
            else:
                context.tracing.stop()
        finally:
            if app.poll() is None:
                app.terminate()
            app.wait(timeout=10)


if __name__ == "__main__":
    run(Path(sys.argv[1]).resolve(strict=True))
