import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

// Backs <FilterBar>: keeps filter values in the URL query string so a filtered view can be
// bookmarked, shared or restored by Back. `fields` is the FilterBar contract (only `name` and
// `type` are used, to coerce query-string values); `defaults` fills anything absent from the URL.
function coerce(field, raw) {
  if (raw === null) return undefined;
  if (field?.type === "checkbox") return raw === "true";
  return raw;
}

function serialize(field, value) {
  if (value === undefined || value === null || value === "") return null;
  if (field?.type === "checkbox") return value ? "true" : null;
  return String(value);
}

export default function useFilterState(fields, defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fieldsByName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);

  const values = useMemo(() => {
    const v = { ...defaults };
    for (const field of fields) {
      if (searchParams.has(field.name)) {
        const coerced = coerce(field, searchParams.get(field.name));
        if (coerced !== undefined) v[field.name] = coerced;
      }
    }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, searchParams]);

  const setValue = useCallback(
    (name, value) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const serialized = serialize(fieldsByName.get(name), value);
          if (serialized === null) next.delete(name);
          else next.set(name, serialized);
          return next;
        },
        { replace: true }
      );
    },
    [fieldsByName, setSearchParams]
  );

  const reset = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  return { values, setValue, reset };
}
