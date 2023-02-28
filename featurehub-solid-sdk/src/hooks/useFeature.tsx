import { Accessor, createEffect, createSignal, onCleanup, on } from "solid-js";
import { ready } from "../components/FeatureHub";
import useFeatureHub from "./useFeatureHub";

/**
 * Convenience hook to subscribe to FeatureHub feature key.
 * NOTE: The key must be defined in your FeatureHub Admin Console.
 *
 * @param {string} key - the feature key
 * @returns {T} value - generic type of feature value (default boolean)
 */
function useFeature<T = boolean>(key: string): Accessor<T> {
  const { client } = useFeatureHub();

  let listenerId: number;
  const [value, setValue] = createSignal(client().feature<T>(key).value);

  createEffect(
    on(ready, () => {
      // Being proper, we only subscribe to features when FeatureHub is ready
      if (!ready()) return;

      if (listenerId) {
        client().feature<T>(key).removeListener(listenerId);
      }

      listenerId = client()
        .feature<T>(key)
        .addListener((fsh) => {
          // @ts-ignore
          setValue(client().feature<T>(key).value);
        });

      // Need this in order for Solid to pick up the initial value properly for some reason
      setValue(() => client().feature<T>(key).value);
    })
  );

  onCleanup(() => {
    client().feature<T>(key).removeListener(listenerId);
  });

  return value;
}

export default useFeature;
