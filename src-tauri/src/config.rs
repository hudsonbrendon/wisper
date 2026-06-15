use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InjectMethod {
    Type,
    Paste,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// Global hotkey accelerator string, e.g. "Alt+Space".
    pub hotkey: String,
    /// Whisper model id from the catalog, e.g. "base.en".
    pub model_id: String,
    /// Input device name; None means the system default device.
    pub mic_device: Option<String>,
    /// Whisper language code, e.g. "en", "pt", or "auto".
    pub language: String,
    /// How transcribed text is inserted into the focused app.
    pub inject_method: InjectMethod,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            hotkey: "Alt+Space".to_string(),
            model_id: "base.en".to_string(),
            mic_device: None,
            language: "en".to_string(),
            inject_method: InjectMethod::Type,
        }
    }
}

impl Config {
    /// Serialize to TOML text.
    pub fn to_toml(&self) -> Result<String, toml::ser::Error> {
        toml::to_string_pretty(self)
    }

    /// Parse from TOML text, falling back to defaults for the whole struct
    /// only if parsing fails entirely.
    pub fn from_toml(text: &str) -> Self {
        toml::from_str(text).unwrap_or_default()
    }
}

use std::path::PathBuf;

/// Returns the on-disk config file path inside the given app config dir.
/// (The caller passes the dir so this stays testable and OS-agnostic.)
pub fn config_path(app_config_dir: &std::path::Path) -> PathBuf {
    app_config_dir.join("config.toml")
}

/// Load config from `app_config_dir/config.toml`, returning defaults if the
/// file does not exist.
pub fn load(app_config_dir: &std::path::Path) -> Config {
    let path = config_path(app_config_dir);
    match std::fs::read_to_string(&path) {
        Ok(text) => Config::from_toml(&text),
        Err(_) => Config::default(),
    }
}

/// Save config to `app_config_dir/config.toml`, creating the dir if needed.
pub fn save(app_config_dir: &std::path::Path, cfg: &Config) -> std::io::Result<()> {
    std::fs::create_dir_all(app_config_dir)?;
    let text = cfg
        .to_toml()
        .map_err(std::io::Error::other)?;
    std::fs::write(config_path(app_config_dir), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_toml() {
        let cfg = Config {
            hotkey: "Ctrl+Shift+D".to_string(),
            model_id: "small".to_string(),
            mic_device: Some("MacBook Pro Microphone".to_string()),
            language: "pt".to_string(),
            inject_method: InjectMethod::Paste,
        };
        let text = cfg.to_toml().expect("serialize");
        let parsed = Config::from_toml(&text);
        assert_eq!(cfg, parsed);
    }

    #[test]
    fn invalid_toml_falls_back_to_default() {
        let parsed = Config::from_toml("this is not valid toml :::");
        assert_eq!(parsed, Config::default());
    }

    #[test]
    fn load_returns_default_when_missing() {
        let dir = std::env::temp_dir().join("openwispr_test_missing_cfg");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), Config::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join("openwispr_test_save_load");
        let _ = std::fs::remove_dir_all(&dir);
        let cfg = Config {
            language: "pt".to_string(),
            ..Config::default()
        };
        save(&dir, &cfg).expect("save");
        assert_eq!(load(&dir), cfg);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
