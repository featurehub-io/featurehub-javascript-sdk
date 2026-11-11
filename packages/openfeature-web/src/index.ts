/**
 * Official OpenFeature provider for FeatureHub (Web/browser).
 *
 * @example
 * ```ts
 * import { OpenFeature } from "@openfeature/web-sdk";
 * import { FeatureHubWebProvider } from "featurehub-openfeature-web-sdk";
 *
 * await OpenFeature.setProviderAndWait(
 *   new FeatureHubWebProvider({
 *     host: "https://edge.featurehub.io",
 *     apiKey: process.env.FEATUREHUB_API_KEY!, // client-evaluated key (`*...`)
 *   }),
 * );
 *
 * const client = OpenFeature.getClient();
 * const enabled = client.getBooleanValue("checkout-v2", false, { targetingKey: "user-123" });
 * ```
 */
export type { ContextAttribute, MappedContext } from "./context-mapper";
export { InvalidContextError, mapEvaluationContext, toContextRecord } from "./context-mapper";
export type { FeatureHubWebProviderOptions } from "./provider";
export { FeatureHubWebProvider } from "./provider";
