import { useCallback, useEffect, useRef } from 'react';

// Returns a function whose identity never changes but always calls the latest closure,
// so memoized children are not re-rendered just because the parent re-rendered.
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
