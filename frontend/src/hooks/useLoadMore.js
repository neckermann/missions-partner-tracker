import { useState } from "react";

// Caps how many rows of a long newest-first list render, with a "Load More" button. It slices what
// is already in memory (the parent fetched the whole collection), so no further request is made.
export default function useLoadMore(items, { initialCount = 3, step = 10 } = {}) {
  const [count, setCount] = useState(initialCount);
  const list = items || [];
  const visible = list.slice(0, count);
  const hasMore = list.length > count;
  function showMore() {
    setCount((c) => c + step);
  }
  return { visible, hasMore, remaining: list.length - count, showMore };
}
