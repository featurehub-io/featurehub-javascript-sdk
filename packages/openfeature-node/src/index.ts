/**
 * Official OpenFeature provider for FeatureHub (Node.js).
 *
 * Serves every OpenFeature resolution from the FeatureHub SDK's local feature
 * repository, which is kept up to date via streaming (SSE), polling, or
 * passive refresh — never with per-flag network calls.
 *
 * @example
 * ```ts
 * import { OpenFeature } from "@openfeature/server-sdk";
 * import { FeatureHubProvider } from "featurehub-openfeature-node-sdk";
 *
 * await OpenFeature.setProviderAndWait(
 *   new FeatureHubProvider({
 *     host: "https://edge.featurehub.io",
 *     apiKey: process.env.FEATUREHUB_API_KEY!, // client-evaluated (`*...`) recommended for servers
 *   }),
 * );
 *
 * const client = OpenFeature.getClient();
 * const enabled = await client.getBooleanValue("checkout-v2", false, {
 *   targetingKey: "user-123",
 *   country: "NZ",
 * });
 * ```
 */
export type { ContextAttribute, MappedContext } from "./context-mapper";
export {
  buildFeatureHubHeader,
  contextSignature,
  InvalidContextError,
  mapEvaluationContext,
  toContextRecord,
} from "./context-mapper";
export type { FeatureHubProviderOptions } from "./provider";
export { FeatureHubProvider } from "./provider";
