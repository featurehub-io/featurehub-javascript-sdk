import { FeatureValueType } from './models';
import { ClientContext } from './client_context';

// these two depend on each other

export interface FeatureListener {
  // eslint-disable-next-line no-use-before-define
  (featureChanged: FeatureStateHolder): void;
}

export interface FeatureStateHolder {
  /**
   * getKey: returns feature key if feature exists
   */
  getKey(): string | undefined;

  get key(): string | undefined;

  /**
   * getString: returns a _string_ type feature value or _undefined_ if the feature does not exist,
   * or its value not of string type or feature has no default value.
   */

  getString(): string | undefined;

  get str(): string | undefined;

  /**
   * getBoolean: returns a _boolean_ type feature value - _true_ or _false_.
   * Returns  _undefined_ if the feature does not exist or not of _boolean_ type.
   */

  getBoolean(): boolean | undefined;

  /**
   * getFlag: returns a _boolean_ type feature value - _true_ or _false_.
   * Returns  _undefined_ if the feature does not exist or not of _boolean_ type. (alternative to getBoolean)
   */
  getFlag(): boolean | undefined;

  get flag(): boolean | undefined;

  /**
   * getNumber: returns a _number_ type feature value or _undefined_ if the feature does not exist, or its value not of number type,
   * or feature has no default value.
   */
  getNumber(): number | undefined;

  get num(): number | undefined;

  /**
   * getRawJson(): returns a raw json feature value represented as _string_ or _undefined_ if the feature does not exist,
   * or its value not of JSON type or feature has no default value.
   */
  getRawJson(): string | undefined;

  get rawJson(): string | undefined;

  /**
   * isSet: in case a feature value is not set (null) (this can only happen for strings, numbers and json types) - this check returns false.
   * If a feature doesn't exist - returns false. Otherwise, returns true.
   */
  isSet(): boolean;

  /**
   * exists: returns true if feature exists, otherwise returns false
   */
  get exists(): boolean;

  /**
   * isLocked: returns true if feature is locked, otherwise returns false
   */

  isLocked(): boolean | undefined;

  get locked(): boolean | undefined;

  /**
   * isEnabled: returns true only if the feature is a boolean and is true, otherwise returns false.
   */
  isEnabled(): boolean;

  get enabled(): boolean;

  addListener(listener: FeatureListener): void;

  // this is intended for override repositories (such as the UserFeatureRepository)
  // to force the listeners to trigger if they detect an actual state change in their layer
  // it passes in the feature state holder to notify with
  triggerListeners(feature?: FeatureStateHolder): void;

  /**
   * getVersion: returns feature update version number (every change on the feature causes its version to update).
   */

  getVersion(): number | undefined;

  get version(): number | undefined;

  getType(): FeatureValueType | undefined;

  get type(): FeatureValueType | undefined;

  withContext(param: ClientContext): FeatureStateHolder;
}
