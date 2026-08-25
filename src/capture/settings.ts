import type { KeyboardStatus } from '../keyboard/device';
import { DEFAULT_OBS_PORT, normalizePort, type ObsStatus } from '../transport/obs';

const KEY = 'halcyon:connection';

export interface ConnectionSettings {
  port: number;
  password: string;
}

/**
 * The password is written to local storage in the clear. For a server that only
 * listens on the loopback interface, on a personal machine, that is judged
 * acceptable — but the interface says so (spec §10).
 */
export function loadSettings(storage: Pick<Storage, 'getItem'>): ConnectionSettings {
  const fallback: ConnectionSettings = { port: DEFAULT_OBS_PORT, password: '' };
  const raw = storage.getItem(KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings>;
    return {
      port: normalizePort(parsed.port),
      password: typeof parsed.password === 'string' ? parsed.password : '',
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: ConnectionSettings,
): void {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Quota, or a browser that refuses to write at all. Saving is a
    // convenience; the caller is in the middle of rebuilding the OBS client,
    // and throwing here would abort that — the user retypes their password and
    // nothing happens, with nothing to explain it.
  }
}

/**
 * Local storage, or an in-memory stand-in when the browser refuses.
 *
 * Reading `localStorage` at all throws when cookies are blocked — not the call,
 * the property access. Unguarded, that happens while the component initialises
 * and the capture page does not mount at all: a blank screen for a setting the
 * user may not even know they have. Credentials simply stop surviving a reload.
 */
export function browserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(KEY);
    return storage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

/**
 * The URL to paste into an OBS browser source.
 *
 * **The password goes in the fragment.** A fragment is never sent to the server
 * — a property of HTTP, not a setting — whereas a query string arrives verbatim
 * in the access log of whoever hosts this page. Since we are that host, handing
 * out a query-string URL would collect our users' OBS credentials.
 *
 * The port stays in the query string: it is not a secret, and seeing it in a
 * log helps diagnose.
 */
export function overlayUrl(origin: string, settings: ConnectionSettings): string {
  const query = new URLSearchParams({ port: String(settings.port) });
  const url = `${origin}/overlay.html?${query}`;
  if (!settings.password) return url;

  const fragment = new URLSearchParams({ password: settings.password });
  return `${url}#${fragment}`;
}

export function keyboardHint(status: KeyboardStatus): string {
  switch (status) {
    case 'connected':
      return 'Keyboard connected.';
    case 'no-permission':
      return 'Click “Allow keyboard” and pick your Wooting.';
    case 'disconnected':
      return 'Plug in your Wooting keyboard.';
    case 'no-analog-interface':
      return 'This device exposes no analog interface. Open the diagnostics panel.';
    case 'unsupported':
      return 'WebHID is required. Use Chrome or Edge on desktop.';
  }
}

export function obsHint(status: ObsStatus): string {
  switch (status) {
    case 'identified':
      return 'Connected to OBS.';
    case 'connecting':
      return 'Connecting to OBS…';
    case 'auth-failed':
      return 'OBS refused the password. Check Tools → WebSocket Server Settings.';
    case 'unreachable':
      // Two dead ends hide behind this status, and neither announces itself:
      // the WebSocket server is off, or Chrome's local network access was
      // refused — it asks exactly once, and a refusal is silent and permanent
      // until site settings lift it. Both have to be named here, because
      // nothing else in the application names the second one.
      //
      // **The keystroke was a third instruction, and it went on 2026-08-24.**
      // The retry does ride on keyboard reports (spec §2.2), so saying it was
      // never wrong — it was just the least valuable sentence in a message
      // that had grown long enough to wrap the status bar onto a third row and
      // push the four other pills apart. Anyone using a keyboard overlay
      // presses a key within seconds, and the wizard's OBS row still spells it
      // out where a beginner is actually looking (`obsNote`).
      return 'OBS is not answering. Enable its WebSocket server in Tools, and allow local network access. Re-allow it in site settings if you refused.';
    case 'disconnected':
      // Retrying rides on keyboard reports, never on a timer (spec §2.2), so
      // the way back is a keystroke — and saying so beats looking stuck.
      return 'OBS closed the connection. Press a key to reconnect.';
    case 'idle':
      return 'Not connected to OBS yet.';
  }
}

/**
 * How many overlays are listening, and where — in one line for the status bar,
 * or `null` when that line would only restate the one above it.
 *
 * **The one in OBS is never folded into a total.** It is the one on air, so it
 * is the figure someone is looking for — and a single number stopped answering
 * that the day anyone opened `overlay.html` in a tab to check that it worked,
 * because the tab is an overlay too (spec §16.7). A diagnostic that its own use
 * invalidates is not a diagnostic.
 *
 * **Silent when nobody is listening and OBS is not answering.** Every heartbeat
 * rides the OBS socket, and the registry is emptied the moment that socket goes
 * (`OverlayRegistry.clear`) — so with OBS down the zero is arithmetic, not an
 * observation. Printing it there adds a second red dot saying nothing the OBS
 * pill has not already said, and wraps the bar onto a third row at the one
 * moment the user has a single thing to fix.
 */
export function overlayTally(
  counts: { inObs: number; inBrowser: number },
  obsConnected: boolean,
): string | null {
  const overlays = (count: number) => `${count} overlay${count === 1 ? '' : 's'}`;

  if (counts.inObs === 0 && counts.inBrowser === 0)
    return obsConnected ? 'No overlay connected' : null;
  if (counts.inObs === 0) return `${overlays(counts.inBrowser)} in a browser`;
  if (counts.inBrowser === 0) return `${overlays(counts.inObs)} in OBS`;
  return `${overlays(counts.inObs)} in OBS · ${counts.inBrowser} in a browser`;
}

/**
 * What the status bar says when a second capture page is on the bus, or `null`
 * when this one is alone.
 *
 * No number in it, and none available to put there: a capture page draws a
 * fresh name on every load, so a tab reloaded three times is three names on
 * this side and one page on the other. The plural is worn by the instruction
 * instead, where it costs nothing to be right for one page or for five.
 *
 * Reloading is not housekeeping. Closing the other pages stops them speaking;
 * reloading this one sends this configuration afresh, which is what takes the
 * overlay back — and it is also the only thing that clears the warning, which
 * never lifts on its own (see `ConfigBroadcaster.hasOtherCapture`).
 */
export function captureWarning(another: boolean): string | null {
  if (!another) return null;
  return 'Other capture pages are open. Close them, then reload this page.';
}

/**
 * What the "OBS browser source" fold says about who is listening.
 *
 * The green half is `inObs` alone, and that is the whole point: this fold
 * exists to prove the source was pasted into OBS, and a tab opened to check
 * the overlay works used to turn it green. The middle case is the one worth
 * wording — it is the exact confusion, and it says which half is missing.
 */
export function sourceState(counts: { inObs: number; inBrowser: number }): string {
  if (counts.inObs > 0) return 'Overlay connected in OBS · receiving frames';
  if (counts.inBrowser > 0) return 'Only a browser tab is listening · no source in OBS yet';
  return 'No overlay has reported in yet';
}
