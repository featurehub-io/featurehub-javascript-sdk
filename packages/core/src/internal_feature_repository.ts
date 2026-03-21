import type { ClientContext } from "./client_context";
import type { FeatureHubRepository } from "./featurehub_repository";
import { type FeatureRolloutStrategy, type FeatureState, SSEResultState } from "./models";
import { Applied } from "./strategy_matcher";

export interface InternalFeatureRepository extends FeatureHubRepository {
  // called when it is ready, but has changed important state (e.g. server eval and the client
  // change the context
  notReady(): void;

  /**
   * Close all registered value interceptors.
   */
  close(): void;

  notify(state: SSEResultState, data: unknown): void;

  /**
   * Is there an interception value for this feature
   *
   * @param key - the key of the feature that is being asked for. It might not even exist in the repo.
   * @param featureState - if the key exists in the repo, this is its featureState
   */
  valueInterceptorMatched(
    key: string,
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined];

  apply(
    strategies: Array<FeatureRolloutStrategy>,
    key: string,
    featureValueId: string,
    context: ClientContext,
  ): Applied;
}
