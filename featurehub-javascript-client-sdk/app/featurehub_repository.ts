import { ClientContext } from './client_context';
import { FeatureStateHolder } from './feature_state';
import { FeatureStateValueInterceptor } from './interceptors';
import { AnalyticsCollector } from './analytics';
import { InternalFeatureRepository } from './internal_feature_repository';
import { CatchReleaseListenerHandler, ReadinessListenerHandle } from './feature_hub_config';

export enum Readyness {
  NotReady = 'NotReady',
  Ready = 'Ready',
  Failed = 'Failed'
}

export interface ReadynessListener {
  (state: Readyness, firstTimeReady: boolean): void;
}

export interface PostLoadNewFeatureStateAvailableListener {
  (repo: InternalFeatureRepository): void;
}

export interface FeatureHubRepository {
  // determines if the repository is ready
  readyness: Readyness;
  catchAndReleaseMode: boolean;

  // allows us to log an analytics event with this set of features
  logAnalyticsEvent(action: string, other?: Map<string, string>, ctx?: ClientContext);

  // returns undefined if the feature does not exist
  hasFeature(key: string): undefined | FeatureStateHolder;

  // synonym for getFeatureState
  feature(key: string): FeatureStateHolder;

  // deprecated
  getFeatureState<T = any>(key: string): FeatureStateHolder<T>;

  // release changes
  release(disableCatchAndRelease?: boolean): Promise<void>;

  // primary used to pass down the line in headers
  simpleFeatures(): Map<string, string | undefined>;

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
  addValueInterceptor(interceptor: FeatureStateValueInterceptor): void;

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
  addReadinessListener(listener: ReadynessListener, ignoreNotReadyOnRegister?: boolean): ReadinessListenerHandle;

  /**
   * Removes an identified readiness listener or does nothing if it doesn't exist.
   *
   * @param listener
   */
  removeReadinessListener(listener: ReadynessListener|ReadinessListenerHandle);

  /**
   * Adds an analytics collector so that requests to record the feature state will be sent there.
   *
   * @param collector
   */
  addAnalyticCollector(collector: AnalyticsCollector): void;

  /**
   * Used by catch/release to indicate that new updates are available to release into the repository. You would generally
   * attach a single handler to this to update your UI recommending a refresh in a single page application.
   *
   * @param listener
   */
  addPostLoadNewFeatureStateAvailableListener(listener: PostLoadNewFeatureStateAvailableListener) : CatchReleaseListenerHandler;

  /**
   * Remove the catch/release handler.
   * @param listener
   */
  removePostLoadNewFeatureStateAvailableListener(listener: PostLoadNewFeatureStateAvailableListener | CatchReleaseListenerHandler);
}
