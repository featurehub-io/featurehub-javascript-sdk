import type { FeatureHubRepository } from "./featurehub_repository";
import type { FeatureState } from "./models";

export interface FeatureValueInterceptor {
  matched(
    key: string,
    repo: FeatureHubRepository,
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined];

  close?(): void;
}
