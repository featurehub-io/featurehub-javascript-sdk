import type { ClientContext } from "./client_context";
import type { FeatureHubRepository } from "./featurehub_repository";
import { InterceptorValueMatch } from "./interceptors";
import { type FeatureRolloutStrategy, SSEResultState } from "./models";
import { Applied } from "./strategy_matcher";

export interface InternalFeatureRepository extends FeatureHubRepository {
  // called when it is ready, but has changed important state (e.g. server eval and the client
  // change the context
  notReady(): void;

  notify(state: SSEResultState, data: any): void;

  valueInterceptorMatched(key: string): InterceptorValueMatch | undefined;

  apply(
    strategies: Array<FeatureRolloutStrategy>,
    key: string,
    featureValueId: string,
    context: ClientContext,
  ): Applied;
}
