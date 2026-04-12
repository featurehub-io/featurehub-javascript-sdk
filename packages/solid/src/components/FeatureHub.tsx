import {
  type ClientContext,
  EdgeFeatureHubConfig,
  FeatureHub as fh,
  type FeatureHubConfig,
  fhLog,
  Readyness,
} from "featurehub-javascript-client-sdk";
import {
  type Accessor,
  type Component,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";

// Global ready signal — consumed by useFeature to know when to subscribe
export const [ready, setReady] = createSignal(false);

export type UseFeatureHub = {
  /** The FeatureHub config object */
  readonly config: Accessor<FeatureHubConfig>;
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
  /** @deprecated Use `userKey` instead. */
  readonly username?: string;
  /** Interval (in milliseconds) to poll FeatureHub for updates. [default: 60 seconds] */
  readonly pollInterval?: number;
  /** Connection type (rest-active, rest-passive, streaming). Defaults to rest-active */
  readonly connectionType?: string;
  /** Wait until the repository becomes ready before rendering the children. [default: true] */
  readonly waitForReady?: boolean;
  /** The Solid application tree to inject the FeatureHub client into */
  readonly children: JSX.Element;
};

/**
 * The FeatureHub Solid component. Use this as a top-level wrapper around your
 * main App component.
 *
 * @param {string} url - the url of the FeatureHub instance (required)
 * @param {string} apiKey - the apiKey key to use. Make sure it is the server-eval key! (required)
 * @param {string} userKey - the userKey to add user information to the FeatureHub context (optional)
 * @param {number} pollInterval - the desired polling interval (ms) to check for value updates (optional -- default 60 seconds)
 * @param {string} connectionType - rest-active, rest-passive, streaming, defaults to rest-active
 * @param {boolean} waitForReady - wait for readiness before rendering children (default true)
 * @param {JSX} children - the Solid component tree to inject FeatureHub into (required)
 *
 */
export const FeatureHub: Component<Props> = (props): JSX.Element => {
  let listenerId: number | undefined;
  const useSharedConfiguration = fh.isCompletelyConfigured();
  const userKey = () => props.username ?? props.userKey ?? "";

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const [client, setClient] = createSignal<ClientContext>(null); // assigned in createMemo below
  const [readiness, setReadiness] = createSignal(Readyness.NotReady);

  /*
    SolidJS eagerly executes createMemo. We use it here to create (or reuse) the
    FeatureHub config once, register the readiness listener, and start the connection.
  */
  const config = createMemo(() => {
    fhLog.log("FeatureHub Solid SDK: Creating config and context...");

    if (!useSharedConfiguration) {
      const cfg = EdgeFeatureHubConfig.config(props.url, props.apiKey);
      if (props.connectionType?.toLowerCase() === "rest-passive") {
        cfg.restPassive(props.pollInterval ?? 60000);
      } else if (props.connectionType?.toLowerCase() === "streaming") {
        cfg.streaming();
      } else {
        cfg.restActive(props.pollInterval ?? 60000);
      }

      fh.setWithContext(cfg, {
        userKey: props.userKey,
      });
    }

    setClient(fh.context); // immediately assign the (anonymous) context

    if (listenerId) {
      fh.config.removeReadinessListener(listenerId);
    }

    listenerId = fh.config.addReadinessListener(setReadiness, true);
    fh.config.init();

    return fh.config;
  });

  /*
    React to readiness state changes and userKey changes. When the connection
    becomes ready, build the context (with or without a user key).
  */
  createEffect(
    on([readiness, userKey], async () => {
      switch (readiness()) {
        case Readyness.Failed:
          if (!ready()) fhLog.error("FeatureHub Solid SDK: Connection failed!");
          break;
        case Readyness.NotReady:
          if (!ready()) fhLog.log("FeatureHub Solid SDK: Connection not ready yet!");
          break;
        default: {
          if (!userKey()) {
            fhLog.log("FeatureHub Solid SDK: Connection ready! Using anonymous user context.");
            await client().build();
            setReady(true);
            return;
          }

          fhLog.log("FeatureHub Solid SDK: Connection ready! Using context with userKey set.");
          setClient(await client().userKey(userKey()).build());
          setReady(true);
        }
      }
    }),
  );

  onCleanup(() => {
    fhLog.log("FeatureHub Solid SDK: Terminating connection!");
    if (listenerId) config().removeReadinessListener(listenerId);
    // Only shut down a config we created ourselves — don't touch shared configuration
    if (!useSharedConfiguration) {
      config().close();
    }
  });

  return (
    <FeatureHubContext.Provider value={{ config, client }}>
      <Show when={props.waitForReady === false || ready()} fallback={<></>}>
        {props.children}
      </Show>
    </FeatureHubContext.Provider>
  );
};
