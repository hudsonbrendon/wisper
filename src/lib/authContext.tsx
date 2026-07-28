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

    const apply = async (u: User | null) => {
      const mine = ++seq;
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
      .then((session) => apply(session?.user ?? null))
      .finally(() => active && setLoading(false));

    const unsub = onAuthChange((session) => {
      void apply(session?.user ?? null);
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
