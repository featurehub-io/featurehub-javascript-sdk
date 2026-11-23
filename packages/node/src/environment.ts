import { parseDuration } from "featurehub-javascript-core-sdk";

/**
 * The settings the Node SDK reads from the environment besides the connection mode and interval
 * (featurehub-protocol.yaml providers.environment_variables.names). Each only supplies what the application
 * has not set in code.
 */
export interface NodeEnvironmentSettings {
  /** FEATUREHUB_EDGE_URL */
  edgeUrl?: string;
  /** FEATUREHUB_CLIENT_API_KEY, or else FEATUREHUB_SERVER_API_KEY */
  apiKey?: string;
  /** FEATUREHUB_POLLING_REQ_TIMEOUT: how long a polling request may take */
  pollingRequestTimeoutMs?: number;
  /** FEATUREHUB_SSE_CONNECT_TIMEOUT: how long opening the stream may take */
  sseConnectTimeoutMs?: number;
  /** FEATUREHUB_SSE_READ_TIMEOUT: how long an open stream may go without data */
  sseReadTimeoutMs?: number;
  /** FEATUREHUB_SSE_INITIAL_RETRY_DELAY: the backoff's base delay */
  sseInitialRetryDelayMs?: number;
  /** FEATUREHUB_SSE_MAX_RETRY_DELAY: the longest wait between reconnection attempts */
  sseMaxRetryDelayMs?: number;
  /** FEATUREHUB_SSE_BACKOFF_MULTIPLIER: how much the wait grows after each consecutive failure */
  sseBackoffMultiplier?: number;
  /** values that were not used, and why */
  warnings: string[];
}

type Environment = Record<string, string | undefined>;

const MULTIPLIER = /^[0-9]+(\.[0-9]+)?$/;

/** Edge may hold a quiet stream open for up to 5 minutes before its bye */
const QUIET_CONNECTION_MS = 5 * 60 * 1000;

function value(env: Environment, name: string): string | undefined {
  const v = env[name]?.trim();
  return v === undefined || v.length === 0 ? undefined : v;
}

export function nodeEnvironment(env: Environment): NodeEnvironmentSettings {
  const settings: NodeEnvironmentSettings = { warnings: [] };

  const duration = (name: string): number | undefined => {
    const raw = value(env, name);
    if (raw === undefined) return undefined;

    const ms = parseDuration(raw);
    if (ms === undefined) {
      settings.warnings.push(
        `${name} is "${raw}", which is not a number and a unit (ms, s, m or h) such as 30s: using the default`,
      );
    }
    return ms;
  };

  const edgeUrl = value(env, "FEATUREHUB_EDGE_URL");
  if (edgeUrl !== undefined) settings.edgeUrl = edgeUrl;

  const apiKey = value(env, "FEATUREHUB_CLIENT_API_KEY") ?? value(env, "FEATUREHUB_SERVER_API_KEY");
  if (apiKey !== undefined) settings.apiKey = apiKey;

  const requestTimeout = duration("FEATUREHUB_POLLING_REQ_TIMEOUT");
  if (requestTimeout !== undefined) settings.pollingRequestTimeoutMs = requestTimeout;

  const connectTimeout = duration("FEATUREHUB_SSE_CONNECT_TIMEOUT");
  if (connectTimeout !== undefined) settings.sseConnectTimeoutMs = connectTimeout;

  const readTimeout = duration("FEATUREHUB_SSE_READ_TIMEOUT");
  if (readTimeout !== undefined) {
    settings.sseReadTimeoutMs = readTimeout;
    if (readTimeout > 0 && readTimeout <= QUIET_CONNECTION_MS) {
      settings.warnings.push(
        `FEATUREHUB_SSE_READ_TIMEOUT is ${readTimeout}ms: Edge may send nothing for up to 5 minutes on a healthy ` +
          "stream, so it should be more than that, or every quiet stream will be treated as a failure",
      );
    }
  }

  const initialDelay = duration("FEATUREHUB_SSE_INITIAL_RETRY_DELAY");
  if (initialDelay !== undefined) settings.sseInitialRetryDelayMs = initialDelay;

  const maxDelay = duration("FEATUREHUB_SSE_MAX_RETRY_DELAY");
  if (maxDelay !== undefined) settings.sseMaxRetryDelayMs = maxDelay;

  const multiplier = value(env, "FEATUREHUB_SSE_BACKOFF_MULTIPLIER");
  if (multiplier !== undefined) {
    if (MULTIPLIER.test(multiplier) && parseFloat(multiplier) >= 1) {
      settings.sseBackoffMultiplier = parseFloat(multiplier);
    } else {
      settings.warnings.push(
        `FEATUREHUB_SSE_BACKOFF_MULTIPLIER is "${multiplier}", which is not a number of at least 1: using the default`,
      );
    }
  }

  return settings;
}
