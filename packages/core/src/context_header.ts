import { type ContextAttribute, type ContextRecord, contextValueToString } from "./client_context";
import type { HashAlgorithm } from "./crypto/types";

/**
 * Hashes `data` with `algorithm`. The value it returns is sent as-is, so a provider used for the
 * contextSha MUST return lowercase hex (featurehub-protocol.yaml encoding.evaluation_context.context_sha).
 */
export type CryptoProvider = (algorithm: HashAlgorithm, data: string) => Promise<string>;

const webCryptoAlgorithms: Record<HashAlgorithm, string> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

/**
 * A lowercase hex digest using the Web Crypto API (`globalThis.crypto.subtle`), which modern browsers and
 * Node 20+ provide.
 */
export const webCryptoHexHash: CryptoProvider = async (algorithm, data) => {
  const digest = await globalThis.crypto.subtle.digest(
    webCryptoAlgorithms[algorithm],
    new TextEncoder().encode(data),
  );

  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

// String() gives JavaScript's number formatting, which the protocol adopts for every SDK (3.0 -> "3"), and a
// date-time is UTC ISO-8601; an invalid Date is left out
function wireValues(attribute: ContextAttribute): string[] {
  if (attribute === undefined || attribute === null) {
    return [];
  }

  const values: Array<unknown> = Array.isArray(attribute) ? attribute : [attribute];

  return values.map((v) => contextValueToString(v)).filter((v): v is string => v !== undefined);
}

/**
 * Builds the canonical x-featurehub header (featurehub-protocol.yaml
 * encoding.evaluation_context.x_featurehub_header): each attribute with at least one value becomes
 * encodeURIComponent(key) + "=" + encodeURIComponent(values joined by ","), the encoded strings are sorted
 * by ordinal comparison and joined with ",". Returns an empty string when no attribute has a value.
 */
export function xFeatureHubHeader(attributes: ContextRecord): string {
  return (
    Object.entries(attributes)
      // fhubWhenActive is a strategy-only name, never supplied by the application
      // (featurehub-protocol.yaml encoding.evaluation_context)
      .filter(([key]) => key.toLowerCase() !== "fhubwhenactive")
      .map(([key, attribute]) => [key, wireValues(attribute)] as const)
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) => `${encodeURIComponent(key)}=${encodeURIComponent(values.join(","))}`)
      .sort()
      .join(",")
  );
}

/**
 * The contextSha query parameter (featurehub-protocol.yaml encoding.evaluation_context.context_sha): the
 * SHA-256 of the x-featurehub header as 64 lowercase hex characters, or "0" when there is no header.
 */
export async function contextSha(
  header: string | undefined,
  hash: CryptoProvider = webCryptoHexHash,
): Promise<string> {
  return header === undefined || header.length === 0 ? "0" : hash("sha256", header);
}
