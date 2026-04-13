import { type ClientContext, FeatureHub as fh } from "featurehub-javascript-client-sdk";

/**
 * @deprecated Use `useFeatureHub` instead.
 * Fetches the FeatureHub client context object
 * @returns {ClientContext} - the FeatureHub client
 */
function useFeatureHubClient(): ClientContext {
  if (fh.isCompletelyConfigured()) {
    return fh.context;
  }

  throw new Error(
    "Cannot get FeatureHub client inside of component not wrapped by the <FeatureHub> component!",
  );
}

export default useFeatureHubClient;
