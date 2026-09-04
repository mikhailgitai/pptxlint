import type { RuleDescriptor } from "../../lint/rule.js";
import type { RuleId } from "../../lint/types.js";

export type EmptyRuleOptions = Readonly<Record<string, never>>;

export function packageRuleDescriptor(
  id: RuleId,
  prerequisites: RuleDescriptor<EmptyRuleOptions>["prerequisites"],
): RuleDescriptor<EmptyRuleOptions> {
  return {
    id,
    defaultSeverity: "error",
    prerequisites,
    defaultOptions: {},
    validateOptions(value) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError("options must be an object.");
      }
      const keys = Object.keys(value);
      if (keys.length > 0) {
        throw new TypeError(
          `unknown option ${JSON.stringify(keys.sort()[0])}.`,
        );
      }
      return {};
    },
  };
}
