import {
  ClientContext,
  EdgeFeatureHubConfig,
  FeatureHubPollingClient,
  Readyness
} from "featurehub-javascript-client-sdk";
import {
  createSignal,
  createEffect,
  createContext,
  JSXElement,
  splitProps,
  onCleanup,
  Component,
  Accessor,
  on,
  onMount
} from "solid-js";

export type UseFeatureHub = {
  readonly config: Accessor<EdgeFeatureHubConfig>;
  readonly client: Accessor<ClientContext>;
};

const tempConfig = new EdgeFeatureHubConfig("", "");
const [config, setConfig] = createSignal(tempConfig);

const tempContext = tempConfig.newContext();
const [client, setClient] = createSignal(tempContext);

export const FeatureHubContext = createContext<UseFeatureHub>(
  { config, client },
  {
    name: "FeatureHub"
  }
);

type Props = {
  /** The url to the running instance of the FeatureHub EDGE API */
  readonly url: string;
  /** The FeatureHub API key -- can be found in the FeatureHub Admin Console */
  readonly apiKey: string;
  /** Scopes FeatureHub context to userKey -- otherwise, context will be anonymous. */
  readonly userKey?: string;
  /** Interval (in milliseconds) to poll FeatureHub for updates. [default: 60 seconds] */
  readonly pollInterval?: number;
  /** The Solid application tree to inject the FeatureHub client into */
  readonly children: JSXElement;
};

/**
 * The FeatureHub Solid component. Use this as a top-level wrapper around your
 * main App component.
 *
 * @param {string} url - the url of the FeatureHub instance (required)
 * @param {string} apiKey - the apiKey key to use. Make sure it is the server-eval key! (required)
 * @param {string} userKey - the optional userKey to add user information to the FeatureHub context (optional)
 * @param {number} pollInterval - the desired polling interval (ms) to check for value updates (optional -- default 60 seconds)
 * @param {JSX} children - the Solid component tree to inject FeatureHub into (required)
 *
 */
const FeatureHub: Component<Props> = (props): JSXElement => {
  const [required, optional] = splitProps(props, ["url", "apiKey", "children"]);

  let activeListenerId: number | undefined;
  const userKey = () => optional.userKey ?? "";

  console.info("FeatureHub Solid SDK: Creating config and context...");
  // eslint-disable-next-line solid/reactivity
  const fhConfig = new EdgeFeatureHubConfig(required.url, required.apiKey);
  fhConfig.edgeServiceProvider(
    // eslint-disable-next-line solid/reactivity
    (repo, c) => new FeatureHubPollingClient(repo, c, optional.pollInterval ?? 60000)
  );
  setConfig(fhConfig);

  const listener = async (readyness: Readyness) => {
    switch (readyness) {
      case Readyness.Failed:
        console.error("FeatureHub Solid SDK: Connection failed!");
        break;
      case Readyness.NotReady:
        console.warn("FeatureHub Solid SDK: Connection not ready yet!");
        break;
      default: {
        if (!userKey()) {
          console.info("FeatureHub Solid SDK: Connection ready! Using anonymous user context.");
          setClient(fhConfig.newContext());
          return;
        }

        console.info("FeatureHub Solid SDK: Connection ready! Using context with userKey set.");
        setClient(await fhConfig.newContext().userKey(userKey()).build());
      }
    }
  };

  createEffect(
    on(userKey, () => {
      if (activeListenerId) {
        fhConfig.removeReadinessListener(activeListenerId);
      }

      const listenerId = fhConfig.addReadinessListener(listener, true);
      activeListenerId = listenerId;
    })
  );

  onMount(() => {
    fhConfig.init();
  });

  onCleanup(() => {
    console.warn("FeatureHub Solid SDK: Terminating connection!");
    if (activeListenerId) fhConfig.removeReadinessListener(activeListenerId);
    fhConfig.close();
  });

  return (
    <FeatureHubContext.Provider value={{ config, client }}>
      {required.children}
    </FeatureHubContext.Provider>
  );
};

export default FeatureHub;
