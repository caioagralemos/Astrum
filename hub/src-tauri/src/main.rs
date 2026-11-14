// Stops a console window from opening beside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    astrum_hub_lib::run()
}
