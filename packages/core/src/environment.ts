import { EdgeType, InvalidConfigurationError, validatePollInterval } from "./feature_hub_config";

/**
 * featurehub-protocol.yaml providers.environment_variables.durations: a single decimal number (with an
 * optional fraction) and a lowercase unit (ms, s, m or h), or 0 with no unit. "30" is not a duration.
 */
const DURATION = /^(0|[0-9]+(\.[0-9]+)?(ms|s|m|h))$/;

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000 };

/** a duration in milliseconds, or undefined if the value does not match the protocol's grammar */
export function parseDuration(value: string): number | undefined {
  const trimmed = value.trim();
  const match = DURATION.exec(trimmed);

  if (!match) {
    return undefined;
  }

  if (trimmed === "0") {
    return 0;
  }

  return Math.round(parseFloat(trimmed) * UNIT_MS[match[3]!]!);
}

export interface EnvironmentConnection {
  /** the mode, when FEATUREHUB_CONNECT_TYPE (or FEATUREHUB_CONNECT_INTERVAL alone) chooses one */
  edgeType: EdgeType;
  /** the interval from FEATUREHUB_CONNECT_INTERVAL, if it is set */
  intervalMs: number | undefined;
  warnings: string[];
}

type Environment = Record<string, string | undefined>;

/**
 * featurehub-protocol.yaml polling_transport.interval.test_mode: FEATUREHUB_TEST_POLLING is on only when it
 * is "true" (any case, trimmed). Anything else, or unset, is off, never an error. For test processes only.
 */
export function testPollingFromEnvironment(env: Environment): boolean {
  return env["FEATUREHUB_TEST_POLLING"]?.trim().toLowerCase() === "true";
}

const isSet = (env: Environment, name: string) =>
  env[name] !== undefined && env[name]!.trim().length > 0;

/**
 * featurehub-protocol.yaml providers.environment_variables.mode_selection: the default mode and interval
 * from FEATUREHUB_CONNECT_TYPE and FEATUREHUB_CONNECT_INTERVAL. Returns undefined when neither is set (an
 * existing SDK then reads its legacy variables). Throws InvalidConfigurationError for a value that is not
 * allowed. An active or passive mode with no interval is not an error here, as the application may give
 * one in code: polling without one is reported when it starts.
 */
export function connectionFromEnvironment(env: Environment): EnvironmentConnection | undefined {
  const typeSet = isSet(env, "FEATUREHUB_CONNECT_TYPE");
  const intervalSet = isSet(env, "FEATUREHUB_CONNECT_INTERVAL");

  if (!typeSet && !intervalSet) {
    return undefined;
  }

  const warnings: string[] = [];
  let intervalMs: number | undefined;

  if (intervalSet) {
    const raw = env["FEATUREHUB_CONNECT_INTERVAL"]!;
    intervalMs = parseDuration(raw);

    if (intervalMs === undefined) {
      throw new InvalidConfigurationError(
        `FEATUREHUB_CONNECT_INTERVAL is "${raw}": it must be a number and a unit (ms, s, m or h), such as 30s, or 0`,
      );
    }

    validatePollInterval(intervalMs, "FEATUREHUB_CONNECT_INTERVAL");
  }

  if (!typeSet) {
    // an interval alone means active polling at it
    return { edgeType: EdgeType.REST_ACTIVE, intervalMs, warnings };
  }

  const raw = env["FEATUREHUB_CONNECT_TYPE"]!;
  switch (raw.trim().toLowerCase()) {
    case "active":
      return { edgeType: EdgeType.REST_ACTIVE, intervalMs, warnings };
    case "passive":
      return { edgeType: EdgeType.REST_PASSIVE, intervalMs, warnings };
    case "streaming":
      if (intervalSet) {
        warnings.push(
          "FEATUREHUB_CONNECT_INTERVAL is not used when FEATUREHUB_CONNECT_TYPE is streaming",
        );
      }
      return { edgeType: EdgeType.STREAMING, intervalMs, warnings };
    default:
      throw new InvalidConfigurationError(
        `FEATUREHUB_CONNECT_TYPE is "${raw}": it must be active, passive or streaming`,
      );
  }
}
