/**
 * Browser crypto utilities using Web Crypto API
 * This module should only be imported in browser environments
 */
import type { HashAlgorithm } from "featurehub-javascript-core-sdk";

const algorithmMap: Record<HashAlgorithm, string> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

/**
 * A lowercase hex digest, the encoding the protocol requires for the contextSha.
 */
export const createHexHash = async (algorithm: string, data: string): Promise<string> => {
  const cryptoAlgorithm = algorithmMap[algorithm as HashAlgorithm];
  if (!cryptoAlgorithm) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  const hashBuffer = await window.crypto.subtle.digest(
    cryptoAlgorithm,
    new TextEncoder().encode(data),
  );

  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
};
