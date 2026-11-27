export type FetchRequestOptions = RequestInit & {
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  path: string;
  method: string;
  search: string;
  headers: Record<string, string>;
  timeout: number;
};
export type ModifyRequestFunction = (options: FetchRequestOptions) => void;

/**
 * The protocol generation this SDK implements (featurehub-protocol.yaml featurehub_edge.sdk_version), sent
 * as the sdk_version query parameter on every poll and streaming connection. It is fixed by the SDK.
 */
export const SDK_VERSION = 2;
