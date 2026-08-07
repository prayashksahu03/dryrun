// 1b.1 — the single visual-identity choke point.
//
// Every visualization asks THIS for a runtime object's identity. No component
// reads `name`, `address`, or frame depth to decide identity anymore — a visual
// object preserves identity SOLELY through its `oid` (TRACE_CONTRACT_v2, LAW 1),
// which the backend stamps on every stack variable, heap block, and call frame.
//
// A `fallback` is accepted for objects that predate identity serialization, so
// the app degrades gracefully rather than collapsing distinct things to one key.
export function getVisualIdentity(obj: unknown, fallback?: string): string | undefined {
  if (obj && typeof obj === 'object' && 'oid' in obj) {
    const v = (obj as { oid?: unknown }).oid;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return fallback;
}
