import { useContext } from "solid-js";
import { FeatureHubContext, type UseFeatureHub } from "../components/FeatureHub";

/**
 * Fetches the FeatureHub config and client objects
 * @returns {UseFeatureHub} - struct containing both the FeatureHub config and client
 */
export function useFeatureHub(): UseFeatureHub {
  const featureHub = useContext(FeatureHubContext);

  if (!featureHub) {
    throw new Error(
      "Error invoking useFeatureHub! Make sure your component is wrapped by the top-level <FeatureHub> component!",
    );
  }

  return featureHub;
}
