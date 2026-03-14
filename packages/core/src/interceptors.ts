import type { InternalFeatureRepository } from "./internal_feature_repository";
import type { FeatureState } from "./models";

export class InterceptorValueMatch {
  public value: string | boolean | number | undefined;

  constructor(value: string | boolean | number | undefined) {
    this.value = value;
  }
}

export interface FeatureStateValueInterceptor {
  matched(key: string, featureState?: FeatureState): InterceptorValueMatch | undefined;
  repository(repo: InternalFeatureRepository): void;
}
