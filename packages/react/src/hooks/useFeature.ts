import type { FeatureStateHolder } from "featurehub-javascript-client-sdk";
import { useEffect, useState } from "react";

import useFeatureHub from "./useFeatureHub";

/**
 * React hook to subscribe to FeatureHub feature key.
 * NOTE: The key must be defined in your FeatureHub Admin Console.
 *
 * @param {string} key - the feature key
 * @returns {T | undefined} value - generic type of feature value (default boolean)
 */
function useFeature<T = boolean>(key: string): T | undefined {
  const featurehub = useFeatureHub();
  const [value, setValue] = useState(featurehub.client.feature<T | undefined>(key).value);

  useEffect(() => {
    const listener = (fsh: FeatureStateHolder<T | undefined>) => setValue(fsh.value);
    const feature = featurehub.client.feature(key);
    const listenerHandler = feature.addListener(listener);

    // if we already have a value when this request is made, trigger the listener otherwise we can use the
    // effect AFTER we have features and the client never uses them.
    if (feature.isSet()) {
      listener(feature);
    }

    return () => {
      featurehub.client.feature(key).removeListener(listenerHandler);
    };
  }, [featurehub, key]);

  return value;
}

export default useFeature;
