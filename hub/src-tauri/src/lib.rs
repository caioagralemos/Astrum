// The desktop window. The hub's work (database, sensors, local server) runs in
// the hub core; this shows its interface.
//
// In the packaged app (scripts/package-mac.sh) the hub travels inside the bundle:
// Contents/Resources/hub (its code), runtime/ (Node, llama-server and their
// libraries) and, unless built with --no-model, model/. This window then starts
// the hub itself, shows a "starting" page until the hub answers, and stops the
// hub when the app quits. Closing the window keeps the hub running; clicking the
// Dock icon brings the window back.
//
// Settings, for a person who cannot set environment variables on a double-click:
// <data folder>/launch.env, one KEY=VALUE per line (ASTRUM_MODE=demo,
// ASTRUM_PORT=4311, ...). A variable already in the environment wins over the file.
// The hub's log: ~/Library/Logs/Astrum/hub.log (ASTRUM_LOGS sets another folder).
//
// Run from the project (npm run app) none of that exists, and the window only
// shows the interface, as before.
//
// On Windows (scripts/package-win.sh) the same folders sit beside Astrum.exe, the
// data folder is %APPDATA%\Astrum, the log %LOCALAPPDATA%\Astrum\Logs\hub.log, and
// closing the window quits (there is no Dock to bring it back).

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, WebviewWindow, WindowEvent};

/// The model file the hub runs on (core/ai.ts).
const MODEL_FILE: &str = "LFM3-1.7B-Q8_0.gguf";
/// How long the hub gets to answer before the window says it did not start.
const START_TIMEOUT: Duration = Duration::from_secs(90);
/// How long the hub gets to stop (it stops its model server first) before it is killed.
const STOP_TIMEOUT: Duration = Duration::from_secs(8);
/// Windows: start a console program without opening a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Hub {
    child: Mutex<Option<Child>>,
    port: u16,
    /// Where the model should be, when it is not there: the hub page then says so.
    missing_model: Option<PathBuf>,
}

/// A setting: the environment first, then launch.env.
fn setting(file: &HashMap<String, String>, key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty()).or_else(|| file.get(key).cloned())
}

fn read_launch_env(path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(text) = fs::read_to_string(path) else { return out };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            out.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
        }
    }
    out
}

fn port_answers(port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(300)).is_ok()
}

fn js_string(s: &str) -> String {
    format!("{:?}", s)
}

/// Shows a line on the "starting" page.
fn status(window: &WebviewWindow, text: &str) {
    let _ = window.eval(format!("window.astrumStatus && window.astrumStatus({})", js_string(text)));
}

/// Windows hands back "verbatim" paths (`\\?\C:\…`, `\\?\UNC\server\share\…`). Node cannot open a script given
/// that way from a network share (it fails on "UNC"), so they are turned back into ordinary paths.
#[cfg(windows)]
fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest.to_string())
    } else {
        path
    }
}
#[cfg(not(windows))]
fn plain_path(path: PathBuf) -> PathBuf {
    path
}

/// Starts the bundled hub, if this is the packaged app. Returns None when run from the project.
fn start_hub(app: &AppHandle) -> Option<Hub> {
    let resources = plain_path(app.path().resource_dir().ok()?);
    let hub_dir = resources.join("hub");
    let runtime = resources.join("runtime").join("bin");
    if !hub_dir.join("core").join("run.ts").exists() {
        return None;
    }
    #[cfg(not(windows))]
    let (default_data, default_logs) = {
        let home = std::env::var("HOME").unwrap_or_default();
        (Path::new(&home).join("Library/Application Support/Astrum"), Path::new(&home).join("Library/Logs/Astrum"))
    };
    #[cfg(windows)]
    let (default_data, default_logs) = {
        let profile = std::env::var("USERPROFILE").unwrap_or_default();
        let roaming = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| Path::new(&profile).join("AppData\\Roaming"));
        let local = std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|_| Path::new(&profile).join("AppData\\Local"));
        (roaming.join("Astrum"), local.join("Astrum").join("Logs"))
    };
    let data = std::env::var("ASTRUM_DATA")
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_data);
    // Nothing is written into the data folder before the hub starts: the hub takes an empty
    // (or missing) folder as a fresh install and shows its first-run setup (core/setup.ts).
    let logs = std::env::var("ASTRUM_LOGS")
        .ok()
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_logs);
    let _ = fs::create_dir_all(&logs);
    let file = read_launch_env(&data.join("launch.env"));

    let port: u16 = setting(&file, "ASTRUM_PORT").and_then(|p| p.parse().ok()).unwrap_or(4310);
    let model = setting(&file, "ASTRUM_MODEL").map(PathBuf::from).unwrap_or_else(|| {
        let bundled = resources.join("model").join(MODEL_FILE);
        if bundled.exists() { bundled } else { data.join("models").join(MODEL_FILE) }
    });
    let missing_model = (!model.exists()).then(|| model.clone());

    let window = app.get_webview_window("main");
    if port_answers(port) {
        // Another hub (the developer's, or a copy of this app) already has the port: never start a second one on it.
        if let Some(w) = &window {
            let w = w.clone();
            let msg = format!("Port {port} is already in use, probably by another Astrum hub. Quit it, or choose another port: add ASTRUM_PORT=4311 to {}, then open Astrum again.", data.join("launch.env").display());
            thread::spawn(move || { thread::sleep(Duration::from_millis(600)); status(&w, &msg); });
        }
        return Some(Hub { child: Mutex::new(None), port, missing_model });
    }

    let log_path = logs.join("hub.log");
    let log = OpenOptions::new().create(true).append(true).open(&log_path).ok()?;
    #[cfg(not(windows))]
    let (node, llama, path) = (runtime.join("node"), runtime.join("llama-server"), format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", runtime.display()));
    #[cfg(windows)]
    let (node, llama, path) = (
        runtime.join("node.exe"),
        runtime.join("llama-server.exe"),
        format!("{};{}", runtime.display(), std::env::var("PATH").unwrap_or_default()),
    );
    let mut cmd = Command::new(node);
    cmd.arg(hub_dir.join("core").join("run.ts"))
        .current_dir(&hub_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().ok()?))
        .stderr(Stdio::from(log))
        .env("PATH", path)
        .env("ASTRUM_DATA", &data)
        .env("ASTRUM_PORT", port.to_string())
        .env("ASTRUM_MODEL", &model)
        .env("ASTRUM_LLAMA", llama);
    // No console window for Node (or the llama-server it starts) beside the app.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // launch.env fills in what the environment does not set.
    for (k, v) in &file {
        if std::env::var(k).map(|v| v.is_empty()).unwrap_or(true) {
            cmd.env(k, v);
        }
    }
    // Production unless asked otherwise: no simulated crew, no simulated Earth replies.
    if setting(&file, "ASTRUM_MODE").is_none() {
        cmd.env("ASTRUM_MODE", "production");
    }
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            if let Some(w) = &window {
                let w = w.clone();
                let msg = format!("The hub could not start: {err}.");
                thread::spawn(move || { thread::sleep(Duration::from_millis(600)); status(&w, &msg); });
            }
            return None;
        }
    };

    let hub = Hub { child: Mutex::new(Some(child)), port, missing_model };
    if let Some(w) = window {
        let handle = app.clone();
        thread::spawn(move || wait_and_show(handle, w, port, log_path));
    }
    Some(hub)
}

/// Waits for the hub to answer, then points the window at it.
fn wait_and_show(app: AppHandle, window: WebviewWindow, port: u16, log: PathBuf) {
    let started = Instant::now();
    loop {
        let exited = app
            .try_state::<Hub>()
            .and_then(|hub| hub.child.lock().ok().and_then(|mut c| c.as_mut().and_then(|c| c.try_wait().ok().flatten())));
        if let Some(code) = exited {
            status(&window, &format!("The hub stopped ({code}). What it said is in {}.", log.display()));
            return;
        }
        if port_answers(port) {
            if let Ok(url) = format!("http://127.0.0.1:{port}/").parse() {
                let _ = window.navigate(url);
            }
            return;
        }
        if started.elapsed() > START_TIMEOUT {
            status(&window, &format!("The hub did not answer in time. What it said is in {}.", log.display()));
            return;
        }
        thread::sleep(Duration::from_millis(300));
    }
}

/// Asks the hub to stop (it stops its model server too), and kills it if it does not.
fn stop_hub(app: &AppHandle) {
    let Some(hub) = app.try_state::<Hub>() else { return };
    let Ok(mut guard) = hub.child.lock() else { return };
    let Some(mut child) = guard.take() else { return };
    #[cfg(not(windows))]
    let _ = Command::new("/bin/kill").args(["-TERM", &child.id().to_string()]).status();
    // Windows has no SIGTERM: end the hub's whole tree (its restarted hub and llama-server too).
    // The database is in WAL mode, so a hard stop loses nothing it had committed.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let started = Instant::now();
    while started.elapsed() < STOP_TIMEOUT {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The line the hub page shows when the model is not where it should be.
fn missing_model_banner(path: &Path) -> String {
    let text = format!(
        "The on-board model is missing, so the AI is off. Put {MODEL_FILE} at {}, then quit and open Astrum again.",
        path.display()
    );
    format!(
        "(() => {{ if (document.getElementById('astrum-model-missing')) return; const d = document.createElement('div'); d.id = 'astrum-model-missing'; d.setAttribute('role', 'alert'); d.textContent = {}; d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:10px 16px;background:#111;color:#f5f5f5;font:13px -apple-system,system-ui,sans-serif;text-align:center;border-top:1px solid #333'; document.body.appendChild(d); }})()",
        js_string(&text)
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            if let Some(hub) = start_hub(app.handle()) {
                app.manage(hub);
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished || payload.url().scheme() != "http" {
                return;
            }
            if let Some(hub) = webview.app_handle().try_state::<Hub>() {
                if payload.url().port() == Some(hub.port) {
                    if let Some(path) = &hub.missing_model {
                        let _ = webview.eval(missing_model_banner(path));
                    }
                }
            }
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the hub running (the crew's devices still talk to it); Quit stops it.
            // Mac only: Windows has no Dock icon to bring a hidden window back, so there closing quits.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "macos") && window.app_handle().try_state::<Hub>().is_some() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("the Astrum window could not start");

    app.run(|handle, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        RunEvent::Exit => stop_hub(handle),
        _ => {}
    });
}
