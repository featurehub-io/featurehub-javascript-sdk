import {
  type ClientContext,
  EdgeFeatureHubConfig,
  FeatureHub as fh,
  type FeatureHubConfig,
  type ReadinessListenerHandle,
  Readyness,
} from "featurehub-javascript-client-sdk";
import { fhLog } from "featurehub-javascript-core-sdk";
import {
  createContext,
  type FC,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
const FeatureHub: FC<Props> = ({
  url,
  apiKey,
  userKey,
  username,
  pollInterval = 60000,
  children,
}) => {
  useMemo(() => {
    fhLog.log("FeatureHub React SDK: Creating config.", fh.isCompletelyConfigured());
    if (!fh.isCompletelyConfigured()) {
      fh.setWithContext(EdgeFeatureHubConfig.config(url, apiKey).restActive(pollInterval), {
        userKey: userKey,
      }).build();
    }
  }, [url, apiKey, pollInterval, userKey]);

  const [client] = useState(fh.context);
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
            return;
          }

          fhLog.log("FeatureHub React SDK: Connection ready! Using context with userKey set.");
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
      fhLog.log("FeatureHub React SDK: Context unmounting. Terminating connection!");
      if (fh.isCompletelyConfigured()) {
        // stop listening
        fh.config.closeEdge();
        // don't tell us any longer
        fh.config.removeReadinessListener(listenerId);
      }
    };
  }, [userKey]);

  return (
    <FeatureHubContext.Provider value={{ config: fh.config, client }}>
      {children}
    </FeatureHubContext.Provider>
  );
};

export default FeatureHub;
