/**
 * Browser crypto utilities using Web Crypto API
 * This module should only be imported in browser environments
 */
import { type HashAlgorithm, webCryptoHexHash } from "featurehub-javascript-core-sdk";

import { sha256Hex } from "./sha256";

const supported: HashAlgorithm[] = ["sha1", "sha256", "sha384", "sha512"];

/**
 * A lowercase hex digest, the encoding the protocol requires for the contextSha, using the Web Crypto API.
 * Browsers leave crypto.subtle out of pages that are not a secure context (served over plain http, other
 * than localhost): there a SHA-256 is computed in JavaScript instead, so the contextSha is still sent.
 */
export const createHexHash = async (algorithm: string, data: string): Promise<string> => {
  if (!supported.includes(algorithm as HashAlgorithm)) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  if (globalThis.crypto?.subtle === undefined) {
    if (algorithm === "sha256") {
      return sha256Hex(data);
    }
    throw new Error(`the Web Crypto API is not available here, so ${algorithm} cannot be computed`);
  }

  return webCryptoHexHash(algorithm as HashAlgorithm, data);
};
