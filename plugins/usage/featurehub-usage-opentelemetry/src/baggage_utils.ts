export const FHUB_BAGGAGE_KEY = "fhub";

/**
 * Parses the raw `fhub` baggage string into a map of key → encoded-value (or undefined).
 * Values are stored still URL-encoded so they can be round-tripped without re-encoding.
 */
export function parseFhubBaggage(raw: string): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      map.set(pair, undefined);
    } else {
      map.set(pair.substring(0, eqIdx), pair.substring(eqIdx + 1));
    }
  }
  return map;
}

/**
 * Builds the `fhub` baggage string from a map, with keys in alphabetical order.
 * Values must already be URL-encoded; undefined values produce a key-only entry (no `=`).
 */
export function buildFhubBaggage(entries: Map<string, string | undefined>): string {
  return [...entries.keys()]
    .sort()
    .map((k) => {
      const v = entries.get(k);
      return v === undefined ? k : `${k}=${v}`;
    })
    .join(",");
}

/**
 * URL-encodes a raw feature value for inclusion in the `fhub` baggage string.
 * Returns undefined when the value is null or undefined (produces a key-only entry).
 */
export function encodeRawValue(rawValue: unknown): string | undefined {
  if (rawValue === undefined || rawValue === null) return undefined;
  return encodeURIComponent(String(rawValue));
}
