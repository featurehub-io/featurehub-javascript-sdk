import {
  ClientContext,
  EdgeFeatureHubConfig,
  EdgeServiceProvider,
  FeatureHubPollingClient,
  Readyness,
  FeatureHub as fh,
} from "featurehub-javascript-client-sdk";
import {
  Accessor,
  Component,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  JSXElement,
  on,
  onCleanup,
} from "solid-js";

// Global ready signal
export const [ready, setReady] = createSignal(false);

export type UseFeatureHub = {
  /** The FeatureHub config object */
  readonly config: Accessor<EdgeFeatureHubConfig>;
  /** The FeatureHub client context */
  readonly client: Accessor<ClientContext>;
};

export const FeatureHubContext = createContext<UseFeatureHub>(
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  null, // this will be assigned by the FeatureHub component
  {
    name: "FeatureHub",
  },
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
 * @param {string} userKey - the userKey to add user information to the FeatureHub context (optional)
 * @param {number} pollInterval - the desired polling interval (ms) to check for value updates (optional -- default 60 seconds)
 * @param {JSX} children - the Solid component tree to inject FeatureHub into (required)
 *
 */
const FeatureHub: Component<Props> = (props): JSXElement => {
  let listenerId: number | undefined;
  const userKey = () => props.userKey ?? "";
  const provider: EdgeServiceProvider = (repo, c) =>
    new FeatureHubPollingClient(repo, c, props.pollInterval ?? 60000);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const [client, setClient] = createSignal<ClientContext>(null); // this will be assigned in createMemo
  const [readiness, setReadiness] = createSignal(Readyness.NotReady);

  // SolidJS 'eagerly' creates things wrapped by createMemo
  const config = createMemo(() => {
    console.info("FeatureHub Solid SDK: Creating config and context...");

    EdgeFeatureHubConfig.defaultEdgeServiceSupplier = provider;
    const fhConfig = EdgeFeatureHubConfig.config(props.url, props.apiKey);
    const context = fhConfig.newContext();
    fh.set(fhConfig, context);

    setClient(context); // immediately assign anonymous context

    if (listenerId) {
      fhConfig.removeReadinessListener(listenerId);
    }

    listenerId = fhConfig.addReadinessListener(setReadiness, true);
    fhConfig.init();

    return fhConfig;
  });

  /*
    Since we already created the config object above from createMemo, we do not have to do that again.
    The only thing that should change hereafter is the readiness state of the connection. So we wrap
    all that deals with readiness in createEffect. The other driver is userKey -- if that value updates,
    we want to rebuild the context with the userKey information provided.
  */
  createEffect(
    on([readiness, userKey], async () => {
      /*
        Observed that this switch case gets called again at an unexpected time with a readiness value
        that is not in sync with the readiness of the config client repository object. To clarify, this
        unexpected, additional call happens AFTER entering into a Readyness.Ready state. Because of that,
        we add ready guards to make sure the console messages get sent when those two values are in sync.

        To verify this, simply log the current value of readiness along with the FeatureHub config object here,
        rebuild the SDK and inspect the readiness value of the underlying _clientRepository object in the browser.
      */
      switch (readiness()) {
        case Readyness.Failed:
          if (!ready()) console.error("FeatureHub Solid SDK: Connection failed!");
          break;
        case Readyness.NotReady:
          if (!ready()) console.warn("FeatureHub Solid SDK: Connection not ready yet!");
          break;
        default: {
          if (!userKey()) {
            console.info("FeatureHub Solid SDK: Connection ready! Using anonymous user context.");
            setReady(true);
            return;
          }

          console.info("FeatureHub Solid SDK: Connection ready! Using context with userKey set.");
          setClient(await client().userKey(userKey()).build());
          setReady(true);
        }
      }
    }),
  );

  onCleanup(() => {
    console.warn("FeatureHub Solid SDK: Terminating connection!");
    if (listenerId) config().removeReadinessListener(listenerId);
    config().close();
  });

  return (
    <FeatureHubContext.Provider value={{ config, client }}>
      {props.children}
    </FeatureHubContext.Provider>
  );
};

export default FeatureHub;
