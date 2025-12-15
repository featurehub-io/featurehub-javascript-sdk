import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js";

import { ready } from "../components/FeatureHub";
import { useFeatureHub } from "./useFeatureHub";

/**
 * Convenience hook to subscribe to FeatureHub feature key.
 * NOTE: The key must be defined in your FeatureHub Admin Console.
 *
 * @param {string} key - the feature key
 * @returns {T | undefined} value - generic type of feature value (default boolean)
 */
export function useFeature<T = boolean>(key: string): Accessor<T | undefined> {
  const { client } = useFeatureHub();

  let listenerId: number;
  const [value, setValue] = createSignal(client().feature<T | undefined>(key).value);

  createEffect(
    on(ready, () => {
      // Being proper, we only subscribe to features when FeatureHub is ready
      if (!ready()) return;

      if (listenerId) {
        client().feature<T | undefined>(key).removeListener(listenerId);
      }

      listenerId = client()
        .feature<T | undefined>(key)
        .addListener(() => {
          setValue(client().feature(key).value);
        });

      // check if the feature exists already, which means the repository already has a value and
      // solid is asking for the effect AFTER the data has already arrived
      if (client().feature<T | undefined>(key).isSet()) {
        setValue(() => client().feature<T | undefined>(key).value);
      }
    }),
  );

  onCleanup(() => {
    client().feature<T | undefined>(key).removeListener(listenerId);
  });

  return value;
}
