import { FeatureHub as fh } from "featurehub-javascript-client-sdk";
import { useContext } from "solid-js";

import { FeatureHubContext, type UseFeatureHub } from "../components/FeatureHub";

/**
 * Fetches the FeatureHub config and client objects
 * @returns {UseFeatureHub} - struct containing both the FeatureHub config and client
 */
export function useFeatureHub(): UseFeatureHub {
  const featureHub = useContext(FeatureHubContext);

  if (featureHub) return featureHub;

  if (fh.isCompletelyConfigured()) {
    return {
      config: () => fh.config,
      client: () => fh.context,
    } as UseFeatureHub;
  }

  throw new Error(
    "Error invoking useFeatureHub! Make sure your component is wrapped by the top-level <FeatureHub> component!",
  );
}
