import { useState } from "react";

// Caps how many rows of a long, newest-first list render by default, with a
// "Load More" button to reveal more of what's already in memory -- the
// parent already fetches the whole collection per partner, so this doesn't
// trigger another request, it just slices what's already there.
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
