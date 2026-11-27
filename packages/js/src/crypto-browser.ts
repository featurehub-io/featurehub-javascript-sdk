/**
 * Browser crypto utilities using Web Crypto API
 * This module should only be imported in browser environments
 */
import { type HashAlgorithm, webCryptoHexHash } from "featurehub-javascript-core-sdk";

/**
 * A lowercase hex digest, the encoding the protocol requires for the contextSha. It is core's Web Crypto
 * hash, which also works in a page that is not a secure context (served over plain http), where browsers
 * provide no crypto.subtle.
 */
export const createHexHash = async (algorithm: string, data: string): Promise<string> => {
  const supported: HashAlgorithm[] = ["sha1", "sha256", "sha384", "sha512"];
  if (!supported.includes(algorithm as HashAlgorithm)) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  return webCryptoHexHash(algorithm as HashAlgorithm, data);
};
