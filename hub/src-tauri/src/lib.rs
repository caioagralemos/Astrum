// The desktop window. The hub's work (database, sensors, local server) runs in
// the hub core; this shows its interface.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("the Astrum window could not start");
}
