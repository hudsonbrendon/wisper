import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./authContext";
import { loadUsage, recordUsage, type Usage } from "./usage";
import { isUnlimited, remainingFor } from "./entitlements";
import { isSupabaseConfigured } from "./supabase";
import { setEntitlements, onEvent } from "./api";

export interface BlockedState {
  reason: "auth" | "quota";
  metric: "dictation" | "meeting";
}

interface UsageState {
  usage: Usage;
  refresh: () => Promise<void>;
  blocked: BlockedState | null;
  clearBlocked: () => void;
}

const EMPTY: Usage = { dictation_words: 0, meetings: 0 };
const UsageContext = createContext<UsageState | null>(null);

export function UsageProvider({ children }: { children: ReactNode }) {
  const { user, plan } = useAuth();
  const [usage, setUsage] = useState<Usage>(EMPTY);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;

  // Compute remaining and push the snapshot to Rust.
  const push = useCallback(
    (u: Usage) => {
      if (!isSupabaseConfigured()) {
        // No backend → metering disabled so the app stays usable.
        setEntitlements({ loggedIn: true, pro: true, remainingWords: 0, remainingMeetings: 0 });
        return;
      }
      if (!user) {
        setEntitlements({ loggedIn: false, pro: false, remainingWords: 0, remainingMeetings: 0 });
        return;
      }
      const pro = isUnlimited(plan);
      setEntitlements({
        loggedIn: true,
        pro,
        remainingWords: pro ? 0 : remainingFor(plan, "dictation_words", u.dictation_words),
        remainingMeetings: pro ? 0 : remainingFor(plan, "meeting", u.meetings),
      });
    },
    [user, plan],
  );

  const refresh = useCallback(async () => {
    if (!user || !isSupabaseConfigured()) {
      setUsage(EMPTY);
      push(EMPTY);
      return;
    }
    const u = await loadUsage();
    setUsage(u);
    push(u);
  }, [user, push]);

  // Re-load + re-push whenever identity or plan changes.
  useEffect(() => {
    void refresh();
  }, [refresh, plan]);

  // React to Rust events: record consumption to the server then re-sync; surface blocks.
  useEffect(() => {
    const consumed = onEvent<{ metric: "dictation_words"; amount: number }>(
      "usage_consumed",
      async (p) => {
        const uid = userIdRef.current;
        if (uid) await recordUsage(uid, p.metric, p.amount);
        await refresh();
      },
    );
    const blockedSub = onEvent<BlockedState>("quota_blocked", (p) => setBlocked(p));
    return () => {
      consumed.then((f) => f());
      blockedSub.then((f) => f());
    };
  }, [refresh]);

  return (
    <UsageContext.Provider
      value={{ usage, refresh, blocked, clearBlocked: () => setBlocked(null) }}
    >
      {children}
    </UsageContext.Provider>
  );
}

export function useUsage(): UsageState {
  const ctx = useContext(UsageContext);
  if (!ctx) throw new Error("useUsage must be used within a UsageProvider");
  return ctx;
}
