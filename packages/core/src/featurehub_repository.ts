import type { EdgeService } from "./edge_service";
import {
  type CatchReleaseListenerHandler,
  EdgeType,
  type FeatureHubConfig,
  type ReadinessListenerHandle,
} from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import type { FeatureValueInterceptor } from "./interceptors";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import type { FeatureState } from "./models";
import type { UsageEvent, UsageEventListener, UsageProvider } from "./usage/usage";

export enum Readyness {
  NotReady = "NotReady",
  Ready = "Ready",
  Failed = "Failed",
}

export type EdgeServiceProvider = (
  repository: InternalFeatureRepository,
  config: FeatureHubConfig,
  edgeType: EdgeType,
  timeout: number,
) => EdgeService;

export interface ReadynessListener {
  (state: Readyness, firstTimeReady: boolean): void;
}

export interface PostLoadNewFeatureStateAvailableListener {
  (repo: InternalFeatureRepository): void;
}

// RawUpdateFeatureListener - The purpose of the RawUpdateFeatureListener is that when feature changes come into the repository
// from our upstream connection - we can update the downstream backup storage so if that goes down and
// we have to refresh our state.
//
// The source parameter is always where the change came from so we can ignore changes from ourself.
export interface RawUpdateFeatureListener {
  // this deletes an individual feature, always use the feature.id if you can
  delete(feature: FeatureState, source: string): void;
  // this replaces all of the features
  processUpdates(features: Array<FeatureState>, source: string): void;
  // this updates an individual feature, always use the feature.id if you can. A feature can change its key.
  processUpdate(features: FeatureState, source: string): void;

  // this asks this listener to close and release any open resources
  close(): void;

  // some config may have changed, check for updates
  configChanged(): void;
}

export interface FeatureHubRepository {
  // determines if the repository is ready
  readyness: Readyness;
  catchAndReleaseMode: boolean;

  // returns undefined if the feature does not exist
  hasFeature(key: string): undefined | FeatureStateHolder;

  // allows one to override the usage provider for this repository. Replace the global defaultUsageProvider
  // if you want it everywhere regardless.
  set usageProvider(provider: UsageProvider);
  get usageProvider(): UsageProvider;

  // synonym for getFeatureState
  feature(key: string): FeatureStateHolder;

  // deprecated
  getFeatureState<T = any>(key: string): FeatureStateHolder<T>;

  // release changes
  release(disableCatchAndRelease?: boolean): Promise<void>;

  // primary used to pass down the line in headers
  simpleFeatures(): Map<string, string | undefined>;

  // allow getting of known keys
  get featureKeys(): Array<string>;

  // only those keys that have come from the the server not ones used in anticipation of
  // state
  get serverProvidedFeatureKeys(): Array<string>;

  getFlag(key: string): boolean | undefined;

  getString(key: string): string | undefined;

  getJson(key: string): string | undefined;

  getNumber(key: string): number | undefined;

  isSet(key: string): boolean;

  /**
   * Allows a feature to call out and determine if there is a contextual override for this feature before
   * returning it. Can be used for example to load values off disk instead of elsewhere.
   *
   * @param interceptor
   */
  addValueInterceptor(interceptor: FeatureValueInterceptor): void;

  /**
   * @deprecated - since version 1.1.6 - use addReadinessListener
   * @param listener
   */
  addReadynessListener(listener: ReadynessListener): number;

  /**
   * Adds a listener and returns a new handle to allow us to remove the listener. This will always trigger the
   * registered listener with the current state unless ignoreNotReadyOnRegister is set to true.
   *
   * @param listener - the listener to trigger when readiness changes
   * @param ignoreNotReadyOnRegister - if true and the readyness state is NotReady, will not fire. You would use this
   * if you register your readiness listener before initialising the repository so you don't get an immediate NotReady
   * trigger.
   */
  addReadinessListener(
    listener: ReadynessListener,
    ignoreNotReadyOnRegister?: boolean,
  ): ReadinessListenerHandle;

  /**
   * Removes an identified readiness listener or does nothing if it doesn't exist.
   *
   * @param listener
   */
  removeReadinessListener(listener: ReadynessListener | ReadinessListenerHandle): void;

  /**
   * Used by catch/release to indicate that new updates are available to release into the repository. You would generally
   * attach a single handler to this to update your UI recommending a refresh in a single page application.
   *
   * @param listener
   */
  addPostLoadNewFeatureStateAvailableListener(
    listener: PostLoadNewFeatureStateAvailableListener,
  ): CatchReleaseListenerHandler;

  /**
   * Remove the catch/release handler.
   * @param listener
   */
  removePostLoadNewFeatureStateAvailableListener(
    listener: PostLoadNewFeatureStateAvailableListener | CatchReleaseListenerHandler,
  ): void;

  // this will ensure that as features get evaluated, your listener will get updates
  registerUsageStream(listener: UsageEventListener): number;

  removeUsageStream(handler: number): void;

  recordUsageEvent(event: UsageEvent): void;

  registerRawUpdateFeatureListener(listener: RawUpdateFeatureListener): number;

  removeRawUpdateFeatureListener(handler: number): void;
}
