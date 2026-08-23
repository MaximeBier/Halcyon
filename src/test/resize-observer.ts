/**
 * A `ResizeObserver` for jsdom, which has none.
 *
 * Installed globally by the setup file rather than guarded for in the
 * components: a `typeof ResizeObserver === 'undefined'` branch in the editor
 * would mean the observing path never runs under test, which is exactly the
 * path task 40 exists to add. A stub that can be fired keeps it exercised.
 *
 * It never measures anything — jsdom lays nothing out, so every box is zero.
 * What it reproduces is the *call*: the browser noticed a size change and told
 * you. Tests set the sizes themselves and then say when the notification lands.
 */
type Callback = () => void;

const observers = new Set<Callback>();

class StubResizeObserver {
  #callback: Callback;

  constructor(callback: Callback) {
    this.#callback = callback;
  }

  observe(): void {
    observers.add(this.#callback);
  }

  unobserve(): void {
    observers.delete(this.#callback);
  }

  disconnect(): void {
    observers.delete(this.#callback);
  }
}

export function installResizeObserver(): void {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
}

/**
 * Fires every live observer, as the browser would after a reflow.
 *
 * Also the assertion that one exists: a component that forgot to observe
 * reports zero here, and a test built on `resized()` fails rather than passing
 * on a measurement that happened to be taken once at mount.
 */
export function resized(): number {
  const fired = observers.size;
  for (const callback of [...observers]) callback();
  return fired;
}
