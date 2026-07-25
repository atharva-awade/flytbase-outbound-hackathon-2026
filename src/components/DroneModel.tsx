"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The drone, in three dimensions, hovering.
 *
 * A decorative element, and the only one in this project. It earns its place
 * because the entire pitch is autonomous drone inspection, and a page about
 * measuring hazardous ground from the air should show the thing doing the
 * measuring.
 *
 * Everything below is about making an ornament cost almost nothing:
 *
 *  - The source model was 14.57 MB, 77 meshes and three animation clips. Run
 *    through gltf-transform with Draco geometry compression and WebP textures it
 *    is 1.73 MB, an eightfold reduction, with the hover animation intact. Meshopt
 *    got it to 1.43 MB but model-viewer will not decode it without registering a
 *    decoder of its own, which it reports only as a console error while showing
 *    nothing, so Draco is the compression that actually works here.
 *  - The renderer is loaded only when the element is actually near the viewport,
 *    and only after the browser is idle, so it never competes with the run data
 *    or the globe for the first paint.
 *  - It is skipped entirely on a small screen, on a metered connection, and when
 *    the visitor has asked for reduced motion. A hovering ornament is exactly the
 *    sort of thing those preferences exist to switch off.
 *  - There is already a WebGL context on the landing page for the globe. This is
 *    a second one, which is fine on a desktop and is another reason it does not
 *    load on a phone.
 *
 * If any of that fails, the element renders nothing at all. Nothing on the page
 * depends on it.
 */
export default function DroneModel({
  className,
  size = 190,
  /** Screen-reader label. The model conveys nothing a reader needs. */
  label = "A slowly hovering autonomous inspection drone",
}: {
  className?: string;
  size?: number;
  label?: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "skipped">("idle");

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    // Reasons not to bother, checked before anything is downloaded.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 900px)").matches;
    const conn = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    const metered = Boolean(conn?.saveData) || /2g/.test(conn?.effectiveType ?? "");
    if (reduced || small || metered) {
      setState("skipped");
      return;
    }

    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const start = async () => {
      if (cancelled) return;
      setState("loading");
      try {
        // Registers the <model-viewer> custom element. Imported here rather than
        // at module scope so the 300 KB renderer is never in the first payload.
        const mod = await import("@google/model-viewer");

        /**
         * Serve the Draco decoder from this origin.
         *
         * The model is Draco compressed, which took it from 14.57 MB to 1.73 MB
         * against 3.86 MB for plain quantization, and Draco needs a WASM decoder
         * to read it. By default model-viewer fetches that from gstatic.com, so
         * on any network where Google's CDN is slow or blocked the drone would
         * silently never appear. 244 KB of decoder is a small price for the
         * page having no off-origin runtime dependency at all.
         */
        const el = (mod as { ModelViewerElement?: { dracoDecoderLocation?: string } }).ModelViewerElement;
        if (el) el.dracoDecoderLocation = "/draco/";

        if (!cancelled) setState("ready");
      } catch {
        // A decoration that fails to load is not an error worth showing.
        if (!cancelled) setState("skipped");
      }
    };

    const whenIdle = (fn: () => void) => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number })
        .requestIdleCallback;
      if (ric) ric(fn, { timeout: 2500 });
      else window.setTimeout(fn, 1200);
    };

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          whenIdle(() => void start());
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  if (state === "skipped") return null;

  return (
    <div
      ref={holder}
      className={className}
      style={{ width: size, height: size, pointerEvents: "none" }}
      aria-hidden="true"
    >
      {state === "ready" && <ModelViewer size={size} label={label} />}
    </div>
  );
}

/**
 * Thin wrapper around the custom element.
 *
 * `model-viewer` is a web component, so React needs it created imperatively to
 * avoid unknown-property warnings and to keep its attributes out of the JSX type
 * space.
 */
function ModelViewer({ size, label }: { size: number; label: string }) {
  const mount = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = mount.current;
    if (!host || host.firstChild) return;

    const mv = document.createElement("model-viewer");
    const attrs: Record<string, string> = {
      src: "/models/drone.glb",
      alt: label,
      // The clip that matters. The file also carries an exploded view and a
      // step-by-step assembly, neither of which belongs on a landing page.
      "animation-name": "hover",
      autoplay: "",
      // "auto" radius lets model-viewer frame the whole model rather than a
      // crop of it. A fixed 3.4m put the camera inside the drone's bounding box,
      // so only its underside was visible and it read as clipped.
      "camera-orbit": "30deg 74deg auto",
      "field-of-view": "auto",
      "interaction-prompt": "none",
      "disable-zoom": "",
      "disable-tap": "",
      "shadow-intensity": "0.55",
      "shadow-softness": "1",
      "environment-image": "neutral",
      exposure: "1.05",
      loading: "lazy",
    };
    for (const [k, v] of Object.entries(attrs)) mv.setAttribute(k, v);
    // A slow drift, so it reads as flying rather than as a spinning showroom prop.
    mv.setAttribute("auto-rotate", "");
    mv.setAttribute("auto-rotate-delay", "0");
    mv.setAttribute("rotation-per-second", "8deg");
    mv.style.width = `${size}px`;
    mv.style.height = `${size}px`;
    mv.style.setProperty("--progress-bar-color", "transparent");
    mv.style.setProperty("--progress-mask", "transparent");
    mv.style.background = "transparent";
    mv.style.opacity = "0";
    mv.style.transition = "opacity 900ms ease";
    mv.addEventListener("load", () => {
      mv.style.opacity = "1";
    });
    host.appendChild(mv);

    return () => {
      mv.remove();
    };
  }, [size, label]);

  return <div ref={mount} style={{ width: size, height: size }} />;
}
