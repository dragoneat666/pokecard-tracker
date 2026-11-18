// components/grading/canvasTools.js — Small helpers for the grading canvases

import { useEffect, useRef, useState } from 'react';

// [ref, width]: the width in css pixels of the element ref is put on, kept up
// to date when the screen turns or the window changes size.
export function useCanvasWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth));
    update();
    const watch = new ResizeObserver(update);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width];
}

// Sizes a canvas to cssW x cssH on screen, with one canvas pixel per screen
// pixel (sharp on phones), then draws with css-pixel coordinates.
export function drawCanvas(canvas, cssW, cssH, draw) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  draw(ctx);
}

// ImageData -> a canvas that can be drawn from (drawImage needs one).
export function imageCanvas(image) {
  const c = new OffscreenCanvas(image.width, image.height);
  c.getContext('2d').putImageData(image, 0, 0);
  return c;
}

// Button handlers that call fn now and then repeatedly while the button is
// held down: const hold = useHoldToRepeat(); <button {...hold(() => ...)}>.
// The timer lives in a ref, not in the handlers, because every call of fn
// redraws the page and makes new handlers; the "let go" handler must still
// find the timer the "press" handler started.
export function useHoldToRepeat() {
  const timer = useRef(null);
  const action = useRef(null);
  const stop = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stop, []);
  return (fn) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      stop();
      action.current = fn;
      action.current();
      let delay = 350;
      const again = () => { action.current?.(); delay = Math.max(40, delay * 0.8); timer.current = setTimeout(again, delay); };
      timer.current = setTimeout(again, delay);
    },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
    onContextMenu: (e) => e.preventDefault(),     // a long press on a phone otherwise opens a menu
  });
}
