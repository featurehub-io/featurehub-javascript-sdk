import {
  type ClientContext,
  EdgeFeatureHubConfig,
  FeatureHub as fh,
  type FeatureHubConfig,
  fhLog,
  type ReadinessListenerHandle,
  Readyness,
} from "featurehub-javascript-client-sdk";
import { createContext, type FC, type ReactNode, useEffect, useRef, useState } from "react";

export type UseFeatureHub = {
  readonly config: FeatureHubConfig;
  readonly client: ClientContext;
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export const FeatureHubContext = createContext<UseFeatureHub>(undefined);
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
}) => {
  const useSharedConfiguration = fh.isCompletelyConfigured();

  fhLog.log("FeatureHub React SDK: Creating config.", useSharedConfiguration);

  const config = useSharedConfiguration ? fh.config : EdgeFeatureHubConfig.config(url, apiKey);
  let context: ClientContext;
  if (!useSharedConfiguration) {
    if (connectionType?.toLowerCase() === "rest-passive") {
      config.restPassive(pollInterval ?? 60000);
    } else if (connectionType?.toLowerCase() === "streaming") {
      config.streaming();
    } else {
      config.restActive(pollInterval ?? 60000);
    }

    context = config.restActive(pollInterval).context({
      userKey: userKey,
    });

    context.build();
  } else {
    context = fh.context;
    context.userKey(userKey).build();
  }

  const [client] = useState(context);
  const [isReady, setIsReady] = useState(config.readiness === Readyness.Ready);
  const activeListenerIdRef = useRef<ReadinessListenerHandle | null>(null);

  useEffect(() => {
    const listener = async (readyness: Readyness) => {
      switch (readyness) {
        case Readyness.Failed:
          fhLog.error("FeatureHub React SDK: Connection failed!");
          break;
        case Readyness.NotReady:
          fhLog.log("FeatureHub React SDK: Connection not ready yet!");
          break;
        default: {
          // TODO: Remove deprecated username prop at some point since userKey keeps API language consistent
          const userInfo = username ?? userKey;

          if (!userInfo) {
            fhLog.log("FeatureHub React SDK: Connection ready! Using anonymous user context.");
            await client.build();
          } else {
            fhLog.log("FeatureHub React SDK: Connection ready! Using context with userKey set.");
            await client.userKey(userInfo).build(); // still the same userKey, doesn't change
          }

          setIsReady(true);
        }
      }
    };

    if (activeListenerIdRef.current !== null) {
      // Remove potential previous existing listener (for use-case when the username updates while component still mounted)
      config.removeReadinessListener(activeListenerIdRef.current);
    }

    const listenerId = config.addReadinessListener(listener, true);

    activeListenerIdRef.current = listenerId; // Keep track of registered listener

    return () => {
      if (config) {
        // don't tell us any longer
        config.removeReadinessListener(listenerId);
      }

      if (!useSharedConfiguration && config) {
        fhLog.trace("FeatureHub React SDK: Terminating connection!");

        // should down the config only if we created it
        config.close();
      }
    };
  }, [userKey]);

  if (waitForReady && !isReady) {
    fhLog.trace("FeatureHub React SDK, not ready yet, returning empty div");
    return <div></div>;
  }

  return (
    <FeatureHubContext.Provider value={{ config: config, client }}>
      {children}
    </FeatureHubContext.Provider>
  );
};

export default FeatureHub;
