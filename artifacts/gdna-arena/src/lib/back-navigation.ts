import { useEffect, useRef } from "react";

const layers = new Map<symbol, { priority: number; back: () => void }>();
export function useBackLayer(active: boolean, back: () => void, priority = 10) {
  const action = useRef(back);
  action.current = back;
  useEffect(() => {
    if (!active) return;
    const key = Symbol();
    layers.set(key, { priority, back: () => action.current() });
    return () => { layers.delete(key); };
  }, [active, priority]);
}

export function closeBackLayer() {
  const layer = [...layers.values()].sort((a, b) => b.priority - a.priority)[0];
  if (!layer) return false;
  layer.back();
  return true;
}

const KEY = "__arenaNavigationDepth";
export function navigationDepth(): number {
  return Number(history.state?.[KEY]) || 0;
}

/** Mark only this app's history, so a direct launch never backs into another site. */
export function trackAppHistory() {
  const push = history.pushState;
  const replace = history.replaceState;
  let initialDepth = navigationDepth();
  if (!initialDepth && document.referrer) {
    try {
      if (new URL(document.referrer).origin === location.origin) initialDepth = 1;
    } catch { /* A direct/invalid referrer is not an app history entry. */ }
  }
  replace.call(history, { ...history.state, [KEY]: initialDepth }, "");
  const trackedPush: History["pushState"] = function (state, unused, url) {
    push.call(history, { ...state, [KEY]: navigationDepth() + 1 }, unused, url);
  };
  const trackedReplace: History["replaceState"] = function (state, unused, url) {
    replace.call(history, { ...state, [KEY]: navigationDepth() }, unused, url);
  };
  history.pushState = trackedPush;
  history.replaceState = trackedReplace;
  return () => {
    if (history.pushState === trackedPush) history.pushState = push;
    if (history.replaceState === trackedReplace) history.replaceState = replace;
  };
}