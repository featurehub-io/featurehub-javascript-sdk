/**
 * Shared implementation for the official FeatureHub OpenFeature providers:
 * context mapping, resolution semantics and the provider lifecycle. This
 * package is an implementation detail of `featurehub-openfeature-node-sdk` and
 * `featurehub-openfeature-web-sdk`; it is published because they depend on it,
 * but it is not intended to be used directly.
 */
export type { ContextAttribute, MappedContext } from "./context-mapper";
export {
  contextSignature,
  InvalidContextError,
  isClientEvaluatedKey,
  mapEvaluationContext,
  toContextRecord,
} from "./context-mapper";
export type {
  BaseProviderOptions,
  ProviderEventSink,
  Transport,
  TransportSelection,
} from "./lifecycle";
export { applyTransport, FeatureHubProviderCore } from "./lifecycle";
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
