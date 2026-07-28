import { invoke } from "@tauri-apps/api/core";
import { once } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export type { Session };

/// Abandoned logins time out after 3 minutes so the loopback port is freed.
const OAUTH_TIMEOUT_MS = 180_000;

/// Parse the OAuth `code` out of the loopback callback URL.
export function extractCode(callbackUrl: string): string | null {
  return new URL(callbackUrl).searchParams.get("code");
}

/// Full desktop PKCE login: start the loopback, open the system browser at the
/// Supabase Google URL, wait for the redirect, then exchange the code.
export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Sign-in is unavailable: Supabase is not configured.");
  }

  const port = await invoke<number>("start_oauth_server");
  const redirectTo = `http://127.0.0.1:${port}`;

  // Hoisted so the init-failure catch block can cancel them if the steps
  // between subscribing and `await callback` throw before we get there.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;

  // Subscribe BEFORE opening the browser so we never miss the redirect.
  // Race the Tauri event against a timeout so an abandoned login doesn't hang
  // the UI forever and leak the Rust loopback thread.
  const callback = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => {
      unlisten?.();
      reject(new Error("Login timed out. Please try again."));
    }, OAUTH_TIMEOUT_MS);

    once<string>("oauth://url", (event) => {
      clearTimeout(timer);
      resolve(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });

  try {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error("OAuth provider returned no URL.");

    await openUrl(data.url);
  } catch (e) {
    clearTimeout(timer);
    unlisten?.();
    throw e;
  }

  const callbackUrl = await callback;
  const code = extractCode(callbackUrl);
  if (!code) throw new Error("OAuth callback returned no authorization code");

  const { error: exchangeError } =
    await getSupabase().auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

/// Restore the persisted session. `error` is what tells "there is no account"
/// apart from "we could not check": a stored-but-unrefreshable session (offline,
/// Supabase unreachable) comes back as `session: null` WITH an error, while a
/// machine that was never signed in comes back null with no error at all.
export async function getSession(): Promise<{
  session: Session | null;
  error: unknown;
}> {
  if (!isSupabaseConfigured()) return { session: null, error: null };
  const { data, error } = await getSupabase().auth.getSession();
  return { session: data.session, error: error ?? null };
}

/// Subscribe to login/logout. The event name is forwarded because only an
/// explicit `SIGNED_OUT` positively means "no account". Returns an unsubscribe
/// function.
export function onAuthChange(
  cb: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => {};
  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    cb(event, session);
  });
  return () => data.subscription.unsubscribe();
}
