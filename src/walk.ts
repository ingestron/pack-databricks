// One tree walk for plain data: every text in a value, mapped, with its JSON
// Pointer. Folding and the view both rewrite texts this way.

/**
 * A copy of `node` with each text replaced by what `map` gives for it. Subtrees whose
 * pointer `skip` names are copied as they are.
 * @example
 * mapStrings({ a: ["x"] }, (text) => text.toUpperCase()); // { a: ["X"] }
 */
export function mapStrings(
  node: unknown,
  map: (text: string, pointer: string) => unknown,
  skip: (pointer: string) => boolean = () => false,
  pointer = "",
): unknown {
  if (skip(pointer)) return node;
  if (typeof node === "string") return map(node, pointer);
  if (Array.isArray(node))
    return node.map((item, index) => mapStrings(item, map, skip, `${pointer}/${index}`));
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      mapStrings(value, map, skip, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
    ]),
  );
}
