//! OS-keychain-backed secure storage for the Supabase auth session.

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "wisper-auth";

/// Map a keyring `get_password` result into our command's Option result: a
/// missing entry is a normal "no session yet", not an error.
fn map_get(res: Result<String, KeyringError>) -> Result<Option<String>, String> {
    match res {
        Ok(v) => Ok(Some(v)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_get(key: String) -> Result<Option<String>, String> {
    map_get(entry(&key)?.get_password())
}

#[tauri::command]
pub fn secure_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_entry_maps_to_none() {
        assert_eq!(map_get(Err(KeyringError::NoEntry)), Ok(None));
    }

    #[test]
    fn present_entry_maps_to_some() {
        assert_eq!(map_get(Ok("token".into())), Ok(Some("token".into())));
    }
}
