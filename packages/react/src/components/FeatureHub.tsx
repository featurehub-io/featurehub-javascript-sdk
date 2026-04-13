import {
  type ClientContext,
  EdgeFeatureHubConfig,
  FeatureHub as fh,
  type FeatureHubConfig,
  fhLog,
  Readyness,
} from "featurehub-javascript-client-sdk";
import {
  createContext,
  type FC,
  type ReactNode,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type UseFeatureHub = {
  readonly config: FeatureHubConfig;
  readonly client: ClientContext;
};

export const FeatureHubContext = createContext<UseFeatureHub | null>(null);
FeatureHubContext.displayName = "FeatureHub";

type Props = {
  /** The url to the running instance of the FeatureHub EDGE API */
  readonly url?: string;
  /** The FeatureHub API key -- can be found in the FeatureHub Admin Console */
  readonly apiKey?: string;
  /** Scopes FeatureHub context to userKey -- otherwise, context will be anonymous. */
  readonly userKey?: string;
  /** @deprecated use 'userKey` instead. */
  /** Use `userKey` prop instead. Scopes FeatureHub context to username -- otherwise, context will be anonymous. */
  readonly username?: string;
  /** Interval (in milliseconds) to poll FeatureHub for updates. [default: 60 seconds] */
  readonly pollInterval?: number;
  /** rest-active, rest-passive, streaming, defaults to rest-active */
  readonly connectionType?: string;
  /** wait until the repository becomes ready before rendering the children */
  readonly waitForReady?: boolean;
  /** The React application tree to inject the FeatureHub client into */
  readonly children: ReactNode;
};

/**
 * The FeatureHub React component. Use this as a top-level wrapper around your
 * main App component.
 *
 * @param {string} url - the url of the FeatureHub instance (required)
 * @param {string} apiKey - the apiKey key to use. Make sure it is the server-eval key! (required)
 * @param {string} userKey - the optional userKey to add user information to the FeatureHub context (optional)
 * @param {number} pollInterval - the desired polling interval (ms) to check for value updates (optional -- default 60 seconds)
 * @param {string} connectionType - rest-active, rest-passive, streaming, defaults to rest-active
 * @param {boolean} waitForReady - wait for readyness before rendering children
 * @param {JSX} children - the React component tree to inject FeatureHub into (required)
 *
 */
const FeatureHub: FC<Props> = ({
  url,
  apiKey,
  userKey,
  username,
  pollInterval = 60000,
  connectionType = "rest-active",
  waitForReady = true,
  children,
}: Props) => {
  const useSharedConfiguration = fh.isCompletelyConfigured();

  const { config, client } = useMemo(() => {
    if (useSharedConfiguration) {
      fhLog.log("FeatureHub React SDK: Using existing configuration.");
      return { config: fh.config, client: fh.context };
    }

    fhLog.log("FeatureHub React SDK: Creating config.");

    const config = EdgeFeatureHubConfig.config(url, apiKey);
    if (connectionType?.toLowerCase() === "rest-passive") {
      config.restPassive(pollInterval);
    } else if (connectionType?.toLowerCase() === "streaming") {
      config.streaming();
    } else {
      config.restActive(pollInterval);
    }

    return { config, client: config.newContext() };
  }, [url, apiKey, pollInterval, connectionType, useSharedConfiguration]); // removed userKey from dependencies to prevent excessive config recreation

  const isReady = useSyncExternalStore(
    (onStoreChange) => {
      const handle = config.addReadinessListener(onStoreChange);
      return () => config.removeReadinessListener(handle);
    },
    () => config.readiness === Readyness.Ready,
  );

  useEffect(() => {
    client.userKey(userKey).build();
  }, [client, userKey]);

  useEffect(() => {
    if (!isReady) {
      if (config.readiness === Readyness.Failed) {
        fhLog.error("FeatureHub React SDK: Connection failed!");
      }
      return;
    }

    const userInfo = username ?? userKey;

    if (userInfo) {
      fhLog.log("FeatureHub React SDK: Connection ready! Using context with userKey set.");
      client.userKey(userInfo).build();
    } else {
      fhLog.log("FeatureHub React SDK: Connection ready! Using anonymous user context.");
      client.build();
    }
  }, [isReady, config, client, userKey, username]);

  useEffect(() => {
    return () => {
      if (!useSharedConfiguration && config) {
        fhLog.trace("FeatureHub React SDK: Terminating connection!");
        config.close();
      }
    };
  }, [config, useSharedConfiguration]);

  if (waitForReady && !isReady) {
    fhLog.trace("FeatureHub React SDK, not ready yet, returning empty div");
    return <div></div>;
  }

  return (
    <FeatureHubContext.Provider value={{ config, client }}>{children}</FeatureHubContext.Provider>
  );
};

export default FeatureHub;
