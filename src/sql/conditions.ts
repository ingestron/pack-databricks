// The condition of each expectation: written from its rule when it has one, else its check
// text (spec/behaviour.md, section 8.5). The rules give the text the check has, so a table's
// file is the same whichever is read.
import type { Expectation, RowRule } from "@ingestron/definitions";
import { sqlString } from "./text.js";

/** A column in backticks, as the definitions package writes it in a check. */
export function columnName(column: string): string {
  return `\`${column.replaceAll("`", "``")}\``;
}

/** A value of a rule: a number as it is, any other value as SQL text. */
function value(item: unknown): string {
  return typeof item === "number" ? String(item) : sqlString(String(item));
}

/** The condition a row passes, as Spark SQL that is never null. */
export function conditionOf(expectation: Expectation): string {
  return expectation.rule ? ruleCondition(expectation.rule) : expectation.check;
}

/** A rule as Spark SQL: a null value fails `notNull`, and `in` and `notIn` without `allowNull`. */
export function ruleCondition(rule: RowRule): string {
  const name = columnName(rule.column);
  switch (rule.kind) {
    case "notNull":
      return `${name} IS NOT NULL`;
    case "in":
    case "notIn": {
      const list = `${name} ${rule.kind === "in" ? "IN" : "NOT IN"} (${rule.values.map(value).join(", ")})`;
      return rule.allowNull ? `${name} IS NULL OR ${list}` : `${name} IS NOT NULL AND ${list}`;
    }
    default:
      return `${name} IS NULL OR ${limits(rule, name).join(" AND ")}`;
  }
}

/** The limits of a rule that a null value passes. */
function limits(rule: Exclude<RowRule, { kind: "notNull" | "in" | "notIn" }>, name: string) {
  switch (rule.kind) {
    case "pattern":
      return [`${name} RLIKE ${value(rule.pattern)}`];
    case "length":
      return bounds(`length(${name})`, rule.min, rule.max, false);
    case "range":
      return bounds(name, rule.min, rule.max, rule.exclusive === true);
    case "multipleOf":
      return [`${name} % ${value(rule.value)} = 0`];
    case "items":
      return [
        ...bounds(`size(${name})`, rule.min, rule.max, false),
        ...(rule.unique ? [`size(array_distinct(${name})) = size(${name})`] : []),
      ];
  }
}

function bounds(of: string, min: unknown, max: unknown, exclusive: boolean): string[] {
  return [
    ...(min === undefined ? [] : [`${of} ${exclusive ? ">" : ">="} ${value(min)}`]),
    ...(max === undefined ? [] : [`${of} ${exclusive ? "<" : "<="} ${value(max)}`]),
  ];
}
