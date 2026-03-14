import { FeatureValueType } from "./models";

export function featureValueFromString(
  valueType: FeatureValueType | undefined,
  value: string | undefined,
): string | number | boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (valueType === undefined) {
    return value;
  }

  switch (valueType) {
    case FeatureValueType.Number:
      return parseFloat(value);
    case FeatureValueType.Boolean: {
      const val = value.toLowerCase();
      return val === "true" || val === "false" || val === "yes" || val == "1" || val === "t";
    }
    case FeatureValueType.String:
    case FeatureValueType.Json:
      return value;
  }
}
