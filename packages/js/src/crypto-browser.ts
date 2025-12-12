/**
 * Browser crypto utilities using Web Crypto API
 * This module should only be imported in browser environments
 */
import type {HashAlgorithm} from "featurehub-javascript-core-sdk";

// import type { HashAlgorithm } from "./types";

const algorithmMap: Record<HashAlgorithm, string> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

export const createBase64UrlSafeHash = async (algorithm: string, data: string): Promise<string> => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  const cryptoAlgorithm = algorithmMap[algorithm as HashAlgorithm];
  if (!cryptoAlgorithm) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  const hashBuffer = await window.crypto.subtle.digest(cryptoAlgorithm, dataBuffer);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to base64
  let binary = "";
  for (let i = 0; i < hashArray.byteLength; i++) {
    binary += String.fromCharCode(hashArray[i]!);
  }

  const base64 = btoa(binary);

  // Convert to base64 url encoding (no padding)
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
