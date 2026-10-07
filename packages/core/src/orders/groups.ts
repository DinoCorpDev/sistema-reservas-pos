import { type Operation, operationOrderIds } from './operations';

/**
 * Groups of connected orders (docs/SYNC.md §4). Transfers, merges and splits link two orders;
 * the cloud folds a whole group at a time, which gives the same result for those orders as
 * folding the whole location (proved by the property tests).
 */

/** Connected groups of order ids, from the links in the operations (union-find). */
export function orderGroups(ops: readonly Operation[]): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression keeps later lookups flat.
    let node = id;
    while (node !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };
  for (const op of ops) {
    const ids = operationOrderIds(op);
    for (const id of ids) add(id);
    for (const id of ids.slice(1)) {
      const a = find(ids[0]!);
      const b = find(id);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const group = groups.get(root);
    if (group) group.push(id);
    else groups.set(root, [id]);
  }
  return [...groups.values()];
}

/** Operations that touch any order of the group. */
export function operationsOfGroup(
  ops: readonly Operation[],
  orderIds: ReadonlySet<string>,
): Operation[] {
  return ops.filter((op) => operationOrderIds(op).some((id) => orderIds.has(id)));
}
