/** Move an item from one index to another, returning a new array. */
export function reorderArrayItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (fromIndex === toIndex) return [...items];
  if (fromIndex < 0 || fromIndex >= items.length) return [...items];
  if (toIndex < 0 || toIndex >= items.length) return [...items];

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return next;
}
