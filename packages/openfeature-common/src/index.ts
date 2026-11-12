/**
 * Shared implementation details for the official FeatureHub OpenFeature
 * providers. This package is an implementation detail of
 * `featurehub-openfeature-node-sdk` and `featurehub-openfeature-web-sdk`; it
 * is published because those packages depend on it, but it is not intended to
 * be used directly.
 */
export type { ContextAttribute, MappedContext } from "./context-mapper";
export {
  buildFeatureHubHeader,
  contextSignature,
  InvalidContextError,
  isClientEvaluatedKey,
  mapEvaluationContext,
  toContextRecord,
} from "./context-mapper";
export type { FeatureKind, FeatureSnapshot } from "./resolution";
export {
  buildFlagMetadata,
  expectedFeatureType,
  flagNotFoundResolution,
  generalErrorResolution,
  invalidContextResolution,
  notReadyResolution,
  resolveFromEvaluation,
  snapshotFeature,
} from "./resolution";
