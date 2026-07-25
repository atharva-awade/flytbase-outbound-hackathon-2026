/**
 * Shared bookkeeping for stacked overlays.
 *
 * Three components can put a layer over the page — the site dialog, the globe's
 * full screen and the map's full screen — and they nest: the map goes full
 * screen inside the dialog. Each one used to set `body.overflow = "hidden"` on
 * open and `""` on close, so closing the inner layer unlocked scrolling while
 * the outer layer was still up. Each also listened for Escape, so one press
 * dismissed every layer at once instead of the top one.
 *
 * Reference counting fixes the first. A layer count fixes the second: a layer
 * only acts on Escape when nothing is stacked above it.
 */

let locks = 0;
let restore = "";

/** Stop the page behind an overlay from scrolling. Returns the release. */
export function lockScroll(): () => void {
  if (locks === 0) {
    restore = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Every overlay here is rendered inside <main>, which isolates its own
    // stacking context, so the sticky header painted over the top of a full
    // screen view no matter what z-index the overlay carried. Marking the body
    // lets the header stand down for the duration — simpler and safer than
    // portalling a canvas the globe renderer mutates in place.
    document.body.dataset.overlay = "1";
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) {
      document.body.style.overflow = restore;
      delete document.body.dataset.overlay;
    }
  };
}

let layers = 0;

/**
 * Register an overlay that sits above whatever is already open. Returns the
 * release, plus `isTop()` so the caller can ignore Escape while something is
 * stacked on top of it.
 */
export function pushLayer(): { release: () => void; isTop: () => boolean } {
  layers += 1;
  const mine = layers;
  let released = false;
  return {
    isTop: () => layers === mine,
    release: () => {
      if (released) return;
      released = true;
      layers = Math.max(0, layers - 1);
    },
  };
}
