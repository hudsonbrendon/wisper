import { getSupabase, isSupabaseConfigured } from "./supabase";
import type { Metric } from "./entitlements";

export interface Usage {
  dictation_words: number;
  meetings: number;
}

interface QueuedEvent {
  user_id: string;
  metric: Metric;
  amount: number;
}

const QUEUE_KEY = "wisper.usage.queue";
const EMPTY: Usage = { dictation_words: 0, meetings: 0 };

function readQueue(): QueuedEvent[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedEvent[];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedEvent[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/// Insert one usage event into Supabase. Returns true on success.
async function insertEvent(e: QueuedEvent): Promise<boolean> {
  const { error } = await getSupabase().from("usage_events").insert(e);
  return !error;
}

/// Replay queued events oldest-first; stop at the first failure so order and
/// at-least-once delivery are preserved.
export async function flushQueue(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  let queue = readQueue();
  while (queue.length > 0) {
    const ok = await insertEvent(queue[0]);
    if (!ok) break;
    queue = queue.slice(1);
    writeQueue(queue);
  }
}

/// Current-week totals from the server. Flushes any queued events first so the
/// returned numbers already include offline activity that just synced.
export async function loadUsage(): Promise<Usage> {
  if (!isSupabaseConfigured()) return EMPTY;
  await flushQueue();
  const { data, error } = await getSupabase().rpc("current_usage");
  if (error || !data) return EMPTY;
  return {
    dictation_words: Number(data.dictation_words ?? 0),
    meetings: Number(data.meetings ?? 0),
  };
}

/// Record consumption. On failure (offline) the event is queued locally and
/// retried by the next flushQueue/loadUsage.
export async function recordUsage(
  userId: string,
  metric: Metric,
  amount: number,
): Promise<void> {
  const event: QueuedEvent = { user_id: userId, metric, amount };
  if (!isSupabaseConfigured() || !(await insertEvent(event))) {
    writeQueue([...readQueue(), event]);
  }
}
