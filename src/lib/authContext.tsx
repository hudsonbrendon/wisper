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
      // A session we hold but could not refresh (no network) tells us nothing:
      // pushing it would demote the data dir to _guest — hiding the user's own
      // history and filing everything dictated offline under the guest account —
      // and slam the gate shut. A local-first app must keep working on a plane,
      // so leave both exactly where they were and wait for a real answer.
      if (!(u || signedOut)) return;
      // Scope the local data dir to this account (or _guest) BEFORE the UI reads
      // history/meetings, so a logout→login never surfaces the old account's
      // data. Failures must not block auth, so swallow them.
      await setActiveUser(u?.id ?? null).catch(() => {});
      // Without Supabase credentials there is nobody to sign in as, so the gate
      // stays open — a fork with no .env is fully usable.
      await setSignedIn(!isSupabaseConfigured() || !!u).catch(() => {});
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
