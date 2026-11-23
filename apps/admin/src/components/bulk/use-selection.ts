"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Rows picked in a list for a batch action. Ids stay picked while the list is filtered or more
 * rows load; `retain` drops the ones no longer shown when that matters (after a filter change).
 */
export function useSelection<Id extends string = string>() {
  const [ids, setIds] = useState<ReadonlySet<Id>>(() => new Set());
  const toggle = useCallback((id: Id, on?: boolean) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  /** Picks every id in `all`, or clears them when they are all picked already. */
  const toggleAll = useCallback((all: readonly Id[]) => {
    setIds((prev) => {
      const every = all.length > 0 && all.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of all) {
        if (every) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setIds(new Set()), []);
  const retain = useCallback((visible: readonly Id[]) => {
    const keep = new Set(visible);
    setIds((prev) => new Set([...prev].filter((id) => keep.has(id))));
  }, []);
  const remove = useCallback((done: readonly Id[]) => {
    setIds((prev) => {
      const next = new Set(prev);
      for (const id of done) next.delete(id);
      return next;
    });
  }, []);
  return useMemo(
    () => ({
      ids,
      list: [...ids],
      count: ids.size,
      has: (id: Id) => ids.has(id),
      /** "all" when every id in `visible` is picked, "some" when a few are, "none" otherwise. */
      state: (visible: readonly Id[]): "all" | "some" | "none" => {
        const picked = visible.filter((id) => ids.has(id)).length;
        return picked === 0 ? "none" : picked === visible.length ? "all" : "some";
      },
      toggle,
      toggleAll,
      clear,
      retain,
      remove,
    }),
    [ids, toggle, toggleAll, clear, retain, remove],
  );
}

export type Selection<Id extends string = string> = ReturnType<typeof useSelection<Id>>;
