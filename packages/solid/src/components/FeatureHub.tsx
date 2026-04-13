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

export type UseFeatureHub = {
  /** The FeatureHub config object */
  readonly config: Accessor<FeatureHubConfig>;
  /** The FeatureHub client context */
  readonly client: Accessor<ClientContext>;
  /** Whether the SDK is ready and flags are loaded */
  readonly ready: Accessor<boolean>;
};

export const FeatureHubContext = createContext<UseFeatureHub | null>(null, {
  name: "FeatureHub",
});

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

export const FeatureHub: Component<Props> = (props): JSX.Element => {
  const useSharedConfiguration = fh.isCompletelyConfigured();
  const userKey = () => props.username ?? props.userKey ?? "";

  const [readiness, setReadiness] = createSignal(Readyness.NotReady);
  const [isReady, setIsReady] = createSignal(false);

  const config = createMemo<FeatureHubConfig>(() => {
    if (useSharedConfiguration) {
      return fh.config;
    }

    const cfg = EdgeFeatureHubConfig.config(props.url, props.apiKey);
    if (props.connectionType?.toLowerCase() === "rest-passive") {
      cfg.restPassive(props.pollInterval ?? 60000);
    } else if (props.connectionType?.toLowerCase() === "streaming") {
      cfg.streaming();
    } else {
      cfg.restActive(props.pollInterval ?? 60000);
    }

    return cfg;
  });

  const client = createMemo(() => {
    if (useSharedConfiguration) {
      return fh.context;
    }
    return config().newContext();
  });

  // Handle initialization and readiness listener
  createEffect(() => {
    const cfg = config();
    const id = cfg.addReadinessListener(setReadiness, true);
    onCleanup(() => cfg.removeReadinessListener(id));
  });

  // Perform initial build on mount
  createEffect(() => {
    const c = client();
    const uk = userKey();
    c.userKey(uk).build();
  });

  // Handle readiness state changes and userKey updates
  createEffect(
    on([readiness, userKey, client], (_, prev) => {
      // Skip the first run as we handle it in the initial build effect above
      if (!prev) return;

      const r = readiness();
      const uk = userKey();
      const c = client();

      switch (r) {
        case Readyness.Failed:
          if (!isReady()) fhLog.error("FeatureHub Solid SDK: Connection failed!");
          break;
        case Readyness.NotReady:
          if (!isReady()) fhLog.log("FeatureHub Solid SDK: Connection not ready yet!");
          break;
        default: {
          fhLog.log(
            `FeatureHub Solid SDK: Connection ready! Using context with userKey: ${uk || "anonymous"}`,
          );
          c.userKey(uk)
            .build()
            .then(() => setIsReady(true));
        }
      }
    }),
  );

  onCleanup(() => {
    if (!useSharedConfiguration) {
      fhLog.log("FeatureHub Solid SDK: Terminating connection!");
      config().close();
    }
  });

  return (
    <FeatureHubContext.Provider value={{ config, client, ready: isReady }}>
      <Show when={props.waitForReady === false || isReady()} fallback={<></>}>
        {props.children}
      </Show>
    </FeatureHubContext.Provider>
  );
};
