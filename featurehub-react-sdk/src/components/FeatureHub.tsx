import { createContext, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ClientContext,
  EdgeFeatureHubConfig,
  FeatureHubPollingClient,
  ReadinessListenerHandle,
  Readyness,
  FeatureHub as fh, FeatureHubConfig
} from "featurehub-javascript-client-sdk";

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
  readonly url: string;
  /** The FeatureHub API key -- can be found in the FeatureHub Admin Console */
  readonly apiKey: string;
  /** Scopes FeatureHub context to userKey -- otherwise, context will be anonymous. */
  readonly userKey?: string;
  /** @deprecated use 'userKey` instead. */
  /** Use `userKey` prop instead. Scopes FeatureHub context to username -- otherwise, context will be anonymous. */
  readonly username?: string;
  /** Interval (in milliseconds) to poll FeatureHub for updates. [default: 60 seconds] */
  readonly pollInterval?: number;
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
 * @param {JSX} children - the React component tree to inject FeatureHub into (required)
 *
 */
export default function FeatureHub({
  url,
  apiKey,
  userKey,
  username,
  pollInterval = 60000,
  children
}: Props): JSX.Element {
  useMemo(() => {
    // Need to guarantee creation of only ONE EdgeFeatureHubConfig instance.
    // Noticed that React has a tendency to create two with the nature of the render cycles
    // despite leveraging useMemo. So we keep a static reference to help us achieve the outcome.
    console.info("FeatureHub React SDK: Creating config.");
    EdgeFeatureHubConfig.defaultEdgeServiceSupplier = ((repo, c) => new FeatureHubPollingClient(repo, c, pollInterval));
    const config = EdgeFeatureHubConfig.config(url, apiKey);
    const context = config.newContext();
    fh.set(config, context);
    context.build();
  }, [url, apiKey, pollInterval]);

  const [client] = useState(fh.context);
  const activeListenerIdRef = useRef<ReadinessListenerHandle | null>(null);

  useEffect(() => {
    const listener = async (readyness: Readyness) => {
      switch (readyness) {
        case Readyness.Failed:
          console.error("FeatureHub React SDK: Connection failed!");
          break;
        case Readyness.NotReady:
          console.warn("FeatureHub React SDK: Connection not ready yet!");
          break;
        default: {
          // TODO: Remove deprecated username prop at some point since userKey keeps API language consistent
          const userInfo = username ?? userKey;

          if (!userInfo) {
            console.info("FeatureHub React SDK: Connection ready! Using anonymous user context.");
            return;
          }

          console.info("FeatureHub React SDK: Connection ready! Using context with userKey set.");
          await client.userKey(userInfo).build(); // still the same userKey, doesn't change
        }
      }
    };

    if (activeListenerIdRef.current !== null) {
      // Remove potential previous existing listener (for use-case when the username updates while component still mounted)
      fh.config.removeReadinessListener(activeListenerIdRef.current);
    }

    const listenerId = fh.config.addReadinessListener(listener, true);
    activeListenerIdRef.current = listenerId; // Keep track of registered listener

    return () => {
      console.warn("FeatureHub React SDK: Context unmounting. Terminating connection!");
      fh.config.removeReadinessListener(listenerId);
      fh.config.close();
    };
  }, [userKey]);

  return (
    <FeatureHubContext.Provider value={{ config: fh.config, client }}>
      {children}
    </FeatureHubContext.Provider>
  );
}
