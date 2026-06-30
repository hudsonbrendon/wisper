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
  fetchPlan,
  subscribePlan,
  signInWithGoogle,
  signOut as signOutFn,
} from "./auth";
import {
  canUseFeature,
  DEFAULT_PLAN,
  type Feature,
  type Plan,
} from "./entitlements";
import { setActiveUser } from "./api";

interface AuthState {
  user: User | null;
  plan: Plan;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [plan, setPlan] = useState<Plan>(DEFAULT_PLAN);
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
      const p = u ? await fetchPlan(u.id) : DEFAULT_PLAN;
      if (!active || seq !== mine) return;
      setUser(u);
      setPlan(p);
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

  // Live plan updates: when the Stripe webhook flips profiles.plan, Realtime
  // delivers it here so Pro unlocks instantly without a reload.
  useEffect(() => {
    if (!user) return;
    const off = subscribePlan(user.id, (p) => setPlan(p));
    return off;
  }, [user]);

  const value: AuthState = {
    user,
    plan,
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

/// Feature gate bound to the current user's plan. `can(feature)` is what UI
/// calls to decide whether to show/enable a feature. Today: always true.
export function useEntitlements(): { can: (feature: Feature) => boolean } {
  const { plan } = useAuth();
  return { can: (feature: Feature) => canUseFeature(plan, feature) };
}
