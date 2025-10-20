import { useEffect, useState } from "react";
import useFeatureHubClient from "./useFeatureHubClient";
import type { FeatureStateHolder } from "featurehub-javascript-client-sdk";

/**
 * React hook to subscribe to FeatureHub feature key.
 * NOTE: The key must be defined in your FeatureHub Admin Console.
 *
 * @param {string} key - the feature key
 * @returns {T | undefined} value - generic type of feature value (default boolean)
 */
function useFeature<T = boolean>(key: string): T | undefined {
  const client = useFeatureHubClient();
  const [value, setValue] = useState(client.feature<T | undefined>(key).value);

  useEffect(() => {
    const listener = (fsh: FeatureStateHolder<T | undefined>) => setValue(fsh.value);

    client.feature(key).addListener(listener);

    return () => {
      client.feature(key).removeListener(listener);
    };
  }, [client, key]);

  return value;
}

export default useFeature;
