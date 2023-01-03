import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react"
import {
  ClientContext,
  EdgeFeatureHubConfig,
  FeatureHubPollingClient,
  ReadinessListenerHandle,
  Readyness,
} from "featurehub-javascript-client-sdk"

export const FeatureHubContext = createContext<ClientContext | null>(null)
FeatureHubContext.displayName = "FeatureHub"

type Props = {
  /** The url to the running instance of the FeatureHub EDGE API */
  readonly url: string
  /** The FeatureHub API key -- can be found in the FeatureHub Admin Console */
  readonly apiKey: string
  /** Scopes FeatureHub context to username -- otherwise, context will be anonymous. */
  readonly username?: string
  /** Interval (in milliseconds) to poll FeatureHub for updates. [default: 60 seconds] */
  readonly pollInterval?: number
  /** The React application tree to inject the FeatureHub client into */
  readonly children: JSX.Element
}

/**
 * The FeatureHub React component. Use this as a top-level wrapper around your
 * main App component.
 * 
 * @param {string} url - the url of the FeatureHub instance (required)
 * @param {string} apiKey - the apiKey key to use. Make sure it is the server-eval key! (required)
 * @param {string} username - the optional username to add user information to the FeatureHub context (optional)
 * @param {number} pollInterval - the desired polling interval (ms) to check for value updates (optional -- default 60 seconds)
 * @param {JSX} children - the React component tree to inject FeatureHub into (required)
 * 
 */
export default function FeatureHub({
  url,
  apiKey,
  username,
  pollInterval = 60000,
  children,
}: Props): JSX.Element {
  const fhConfig = useMemo(() => new EdgeFeatureHubConfig(url, apiKey), [apiKey, url])
  const [client, setClient] = useState(fhConfig.newContext())
  const activeListenerIdRef = useRef<ReadinessListenerHandle | null>(null)

  useEffect(() => {
    fhConfig.edgeServiceProvider((repo, c) => new FeatureHubPollingClient(repo, c, pollInterval))
  }, [pollInterval])

  useEffect(() => {
    const listener = async (readyness: Readyness) => {
      switch (readyness) {
        case Readyness.Failed:
          console.error("FeatureHub connection failed!")
          break;
        case Readyness.NotReady:
          console.warn("FeatureHub connection not ready yet!")
          break;
        default: {
          console.info("FeatureHub React SDK connected!");

          if (!username) {
            console.info("Username not found -- using anonymous user context.")
            return
          }
    
          console.info("Username found -- building new context with userKey set.")
          setClient(await fhConfig.newContext().userKey(username).build())
        }
      }
    }

    if (activeListenerIdRef.current !== null) {
      // Remove potential previous existing listener (for use-case when the username updates while component still mounted)
      fhConfig.removeReadinessListener(activeListenerIdRef.current)
    }

    const listenerId = fhConfig.addReadinessListener(listener, true)
    activeListenerIdRef.current = listenerId // Keep track of registered listener
    fhConfig.init()

    return () => {
      console.info("FeatureHub unmounting -- terminating connection!")
      fhConfig.removeReadinessListener(listenerId)
      fhConfig.close()
    }
  }, [username])

  return (
    <FeatureHubContext.Provider value={client}>
      {children}
    </FeatureHubContext.Provider>
  )
}
