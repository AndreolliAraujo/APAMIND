use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

#[derive(Default)]
struct CloseProtectionGate(AtomicBool);

impl CloseProtectionGate {
    fn should_block_close(&self) -> bool {
        !self.0.load(Ordering::Acquire)
    }
}

#[tauri::command]
fn mark_close_listener_ready(gate: tauri::State<'_, CloseProtectionGate>) {
    gate.0.store(true, Ordering::Release);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if option_env!("APAMIND_HOMOLOGACAO_DIAGNOSTICO").is_some() {
        install_diagnostic_capture();
        diagnostic_write("STARTUP: entered app_lib::run");
    }

    tauri::Builder::default()
        .manage(CloseProtectionGate::default())
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .app_handle()
                    .state::<CloseProtectionGate>()
                    .should_block_close()
                {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![mark_close_listener_ready])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) || option_env!("APAMIND_HOMOLOGACAO").is_some() {
                let mut logger = tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info);
                if option_env!("APAMIND_HOMOLOGACAO").is_some() {
                    logger = logger.target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("apamind-homologacao".into()),
                        },
                    ));
                }
                app.handle().plugin(logger.build())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod close_protection_tests {
    use super::CloseProtectionGate;
    use std::sync::atomic::Ordering;

    #[test]
    fn close_is_blocked_until_frontend_listener_is_confirmed() {
        let gate = CloseProtectionGate::default();
        assert!(gate.should_block_close());

        gate.0.store(true, Ordering::Release);
        assert!(!gate.should_block_close());
    }
}

fn diagnostic_write(message: &str) {
    if option_env!("APAMIND_HOMOLOGACAO_DIAGNOSTICO").is_none() {
        return;
    }

    use std::io::Write as _;
    let log_path = std::env::temp_dir()
        .join("ApaMind-Homologacao-Diagnostico-0.7.1")
        .join("startup-diagnostic.log");

    let result = (|| -> std::io::Result<()> {
        if let Some(parent) = log_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        writeln!(file, "{message}")?;
        file.flush()
    })();

    if let Err(error) = result {
        eprintln!("ApaMind diagnostic log write failed ({}): {error}", log_path.display());
        eprintln!("{message}");
    }
}

fn install_diagnostic_capture() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        diagnostic_write(&format!(
            "PANIC: {panic_info}\nBACKTRACE:\n{}",
            std::backtrace::Backtrace::force_capture()
        ));
        previous_hook(panic_info);
    }));
}
