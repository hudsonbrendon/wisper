import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  getSession,
  onAuthChange,
  signInWithGoogle,
  signOut as signOutFn,
} from "./auth";
import { isSupabaseConfigured } from "./supabase";
import { setActiveUser, setSignedIn } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let seq = 0;

    // `signedOut` means we POSITIVELY know there is no account, not merely that
    // we have no user object right now.
    const apply = async (u: User | null, signedOut: boolean) => {
      const mine = ++seq;
      // Scope the local data dir to this account (or _guest) BEFORE the UI reads
      // history/meetings, so a logout→login never surfaces the old account's
      // data. Failures must not block auth, so swallow them.
      await setActiveUser(u?.id ?? null).catch(() => {});
      // Without Supabase credentials there is nobody to sign in as, so the gate
      // stays open — a fork with no .env is fully usable.
      const open = !isSupabaseConfigured() || !!u;
      // Only push a `false` we are sure of. A session we hold but could not
      // refresh (no network) leaves the gate exactly where it was: a local-first
      // dictation app must keep working on a plane.
      if (open || signedOut) await setSignedIn(open).catch(() => {});
      if (!active || seq !== mine) return;
      setUser(u);
    };

    getSession()
      .then(({ session, error }) => apply(session?.user ?? null, !error))
      .finally(() => active && setLoading(false));

    const unsub = onAuthChange((event, session) => {
      void apply(session?.user ?? null, event === "SIGNED_OUT");
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const value: AuthState = {
    user,
    loading,
    signIn: signInWithGoogle,
    signOut: signOutFn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
