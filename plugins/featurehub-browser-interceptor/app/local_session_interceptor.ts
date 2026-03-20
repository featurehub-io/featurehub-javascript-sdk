// this is a UsagePlugin and Interceptor at the same time, you need to register a single instance
// as both for it to work as expected.

import {
  type FeatureValueInterceptor,
  type UsagePlugin,
  type UsageEvent,
  UsageEventWithFeature,
  type FeatureHubUsageValue,
  type FeatureHubRepository,
  UsageFeaturesCollection,
  type FeatureState,
  featureValueFromString,
} from "featurehub-javascript-core-sdk";

export class LocalSessionInterceptor implements FeatureValueInterceptor, UsagePlugin {
  private readonly _storage: Storage;
  private readonly _window: Window;
  // private _alreadySetListener: boolean = false;
  protected _defaultPluginAttributes: Record<string, any> = {};
  public canSendAsync = true;

  constructor(win?: Window, storage?: Storage) {
    this._window = win ?? window;
    this._storage = storage || this._window.localStorage;

    // this._alreadySetListener = true;

    // this._window.addEventListener("storage", (e: StorageEvent) =>
    //   this.storageChangedListener(e, this.repo!),
    // );
  }

  public get defaultPluginAttributes(): Record<string, any> {
    return this._defaultPluginAttributes;
  }

  // when this triggers, it checks to see what the current state of the features in local storage
  // is, then it corrects them, then it triggers a storage event in case there is some nice UI
  // widget listening for these changes.
  public send(event: UsageEvent): void {
    if (event instanceof UsageEventWithFeature) {
      this.processUsageFeature((event as UsageEventWithFeature).feature);
    } else if (event instanceof UsageFeaturesCollection) {
      (event as UsageFeaturesCollection).featureValues.forEach((feature) =>
        this.processUsageFeature(feature),
      );
    }
  }

  private processUsageFeature(feature: FeatureHubUsageValue) {
    const value = feature.rawValue;
    const key = feature.key;

    // if it has a value, this will be the key it is stored in
    const hasValueKey = this._valueName(key);
    // if it has a "null" or undefined value (as opposed to not existing), it has this
    // key
    const nilValueKey = this._nullName(key);

    // check to see if the "exists but is null" exists
    const nullCheck = this._storage[nilValueKey];
    // check if the actual value exists
    const val = nullCheck ? undefined : this._storage[hasValueKey];

    // we track if we are updating the _storage so the _storage changed
    // listener doesn't trigger too early. It can trigger after the second
    // change so it will if necessary force a state change.
    if (value === undefined) {
      // the value is undefined, but has it changed, was it undefined before?
      if (!nullCheck) {
        // set the nil val key and remove a key indicating there was a value
        this._storage.setItem(nilValueKey, "null");
        this._storage.removeItem(hasValueKey);
        // this._window.dispatchEvent(
        //   new StorageEvent("storage", {
        //     oldValue: val,
        //     newValue: value,
        //     key: hasValueKey,
        //   }),
        // );
      }
    } else {
      const newValue = value.toString();
      // if it used to be null or its value has changed
      if (nullCheck || newValue !== val) {
        // remove the nil value key and set the has value key
        this._storage.removeItem(nilValueKey);
        this._storage.setItem(hasValueKey, newValue);
      }
      // this._window.dispatchEvent(
      //   new StorageEvent("storage", {
      //     oldValue: val,
      //     newValue: value,
      //     key: hasValueKey,
      //   }) as StorageEvent,
      // );
    }
  }

  matched(
    key: string,
    _repo: FeatureHubRepository,
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined] {
    if (this._storage) {
      const nullCheck = this._storage[this._nullName(key)];

      if (nullCheck) {
        return [true, undefined];
      }

      const val = this._storage[this._valueName(key)];

      if (val) {
        return [true, featureValueFromString(featureState?.type, val)];
      }
    }

    return [false, undefined];
  }

  private _nullName = (key: string): string => `fh_null_${key}`;

  private _valueName = (key: string): string => `fh_value_${key}`;

  // private static storageChangedListener(e: StorageEvent, repo: FeatureHubRepository) {
  //   let key: string = undefined;
  //
  //   // ideal would be to have a post load event, find all the features
  //   // that have overridden states and track them as they change so
  //   // that we on a "clear" trigger the right listeners. This is MVP.
  //   if (e === undefined || e.key === undefined || e.key === null) {
  //     return;
  //   }
  //
  //   if (repo === undefined) {
  //     fhLog.error("repo is undefined for the storage change listener.");
  //     return;
  //   }
  //
  //   if (e.key.startsWith("fh_null_")) {
  //     key = e.key.substring("fh_null_".length);
  //   } else if (e.key.startsWith("fh_value_")) {
  //     key = e.key.substring("fh_value_".length);
  //   }
  //
  //   if (key !== undefined && e.oldValue !== e.newValue) {
  //     // this will return a UserRepoHolder if we are actually overriding
  //     // and thus it is different from the underlying value
  //     const feature = repo.feature(key);
  //     if (feature && !feature.isLocked()) {
  //       feature.triggerListeners();
  //     }
  //   }
  // }
}
