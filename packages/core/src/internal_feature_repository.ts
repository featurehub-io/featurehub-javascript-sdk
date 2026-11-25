import type { ClientContext, ContextRecord } from "./client_context";
import type { EvaluatedFeature } from "./evaluated_feature";
import type { FeatureHubRepository } from "./featurehub_repository";
import { type FeatureRolloutStrategy, type FeatureState, SSEResultState } from "./models";
import { Applied } from "./strategy_matcher";

export interface InternalFeatureRepository extends FeatureHubRepository {
  // called when the context of a server-evaluated key changes: the features held are for the old
  // context, so readiness goes from Ready to Stale until the new context's features arrive
  notReady(): void;

  /**
   * The source says the environment is stale and will send no further updates (a 236 when polling,
   * edge.stale when streaming). Readiness goes from Ready to Stale and stays there.
   */
  markEnvironmentStale(): void;

  /**
   * Close all registered value interceptors.
   */
  close(): void;

  notify(state: SSEResultState, data: unknown, source: string): void;

  used(
    value: EvaluatedFeature,
    attrs: ContextRecord | undefined,
    userKey: string | undefined,
  ): void;

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
