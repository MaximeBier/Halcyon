import type { KeyboardStatus } from '../keyboard/device';
import {
  createObsClient,
  DEFAULT_OBS_PORT,
  normalizePort,
  type ObsClient,
  type ObsClientOptions,
  type ObsStatus,
} from '../transport/obs';

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
      // Names the gesture, not a control elsewhere on the page: the pill is
      // the button now (`canPickDevice`), and pointing at the panel's “Allow
      // keyboard” from a line that does the same thing sends the reader away
      // from the thing under their cursor.
      return 'Pick your Wooting keyboard.';
    case 'disconnected':
      return 'Plug in your Wooting keyboard.';
    case 'no-analog-interface':
      // **The firmware first, because it is what it turns out to be.** Seen on
      // 2026-08-24: a supported model, a firmware left behind, and the 0xFF53
      // usage page simply absent. The old wording sent people to the
      // diagnostics panel, which shows neither the vendor id nor the usage
      // pages — it could not answer the question it invited. The picker is the
      // other half: Chrome lists every HID interface this vendor exposes, and
      // the wrong one is easy to choose.
      return 'No analog interface. Update the firmware in Wootility, or pick another device.';
    case 'open-failed':
      // The device answered and was authorised — it just refused to open,
      // which on Windows means something else already has it exclusively
      // (spec §10). Naming Wootility is the concrete first guess, same
      // reasoning as the firmware wording above: send the reader to the thing
      // that turns out to be true most often, not to a diagnostics panel that
      // cannot see who is holding the device either.
      return "Couldn't open the keyboard — close Wootility or other tabs using it, then try again.";
    case 'unsupported':
      return 'WebHID is required. Use Chrome or Edge on desktop.';
  }
}

/**
 * Whether the keyboard pill is worth clicking — the device picker as its own
 * gesture (spec §11).
 *
 * The panel's own button already covers three of these, for the same reason:
 * nothing chosen yet, nothing plugged in, or the wrong interface chosen out
 * of the several Chrome lists for the vendor. `open-failed` joins them:
 * `keyboardHint` tells the reader to "try again", and requestPermission() is
 * that retry — reopening the picker and choosing the same device calls
 * open() a second time. Leaving it out made the pill an inert `<span>`
 * (`StatusBar.svelte` only wraps a `<button>` when this returns true) under
 * copy that explicitly invites a click — found in review on 2026-09-04.
 *
 * A working keyboard needs no gesture, and a browser without WebHID has no
 * picker to open — a control that cannot help is how someone presses it four
 * times.
 */
export function canPickDevice(status: KeyboardStatus): boolean {
  return (
    status === 'no-permission' ||
    status === 'disconnected' ||
    status === 'no-analog-interface' ||
    status === 'open-failed'
  );
}

/**
 * Whether the OBS pill is worth clicking — one fresh attempt at the socket.
 *
 * `unreachable`: the attempt is itself what raises Chrome's local network
 * prompt, and the WebSocket server may have been switched on since the last
 * one, so a click has two ways to succeed. **It has one way to do nothing:**
 * a local network permission already refused cannot be asked for again from
 * the page — Chrome allows no way back but its own site settings, which is why
 * `obsHint` keeps naming them.
 *
 * `disconnected` joined it for the same reason `open-failed` joined
 * `canPickDevice`: `obsHint` tells this state to "press a key to reconnect",
 * which is unexecutable without a keyboard plugged in and typing — and
 * `reconnect()` (App.svelte) is exactly that keystroke's effect, made into a
 * click. Copy that invites a gesture the pill refuses is how someone presses
 * it and nothing happens. Found in review on 2026-09-04.
 *
 * A refused password wants the field rather than another identical attempt,
 * and the three healthy/in-progress states — identified, connecting, idle —
 * have nothing to retry.
 */
export function canRetryObs(status: ObsStatus): boolean {
  return status === 'unreachable' || status === 'disconnected';
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
 * The four ways a throwaway probe can end, plus the marker for one still
 * running. `idle` and `connecting` are excluded on purpose: `connecting` is
 * the question, never the answer, and `idle` is only ever what a probe's own
 * `close()` reports on itself — `createObsProbe` swallows that one before it
 * reaches a caller. What is left is exactly what `obsProbeHint` has to say a
 * sentence for.
 */
export type ObsProbeStatus = Exclude<ObsStatus, 'idle' | 'connecting'> | 'testing';

/**
 * Plain sentences for the Diagnostics panel's probe, deliberately not
 * `obsHint`: that one is written for the live connection, permanent in the
 * status bar and pointing at what to do next (Tools menu, site settings). The
 * probe is a one-off answer to "is this good right now" — it needed its own
 * short wording, not the enum value itself, which is what showed until
 * reviewed on 2026-09-04 ("identified", "auth-failed", "unreachable" printed
 * raw while every other surface in the app translates).
 */
export function obsProbeHint(status: ObsProbeStatus): string {
  switch (status) {
    case 'testing':
      return 'Testing…';
    case 'identified':
      return 'Connection OK.';
    case 'auth-failed':
      return 'Password refused.';
    case 'unreachable':
      return 'Server unreachable.';
    case 'disconnected':
      // Reachable only if the handshake finished and OBS then closed the
      // socket in the instant before this probe did — vanishingly unlikely
      // for a connection nothing is ever sent through, but the type includes
      // it, so the sentence has to exist.
      return 'Connected, then the server closed it.';
  }
}

/**
 * Runs the Diagnostics panel's throwaway OBS connection — a fresh socket
 * that exists to answer one question, "are the port and password as typed
 * good, right now" — and guards it against two problems the click site used
 * to have, found in review on 2026-09-04:
 *
 * - Two rapid clicks opened two sockets that raced each other to answer, and
 *   OBS showed a second client for good if the first was never told to close.
 * - The probe closes itself once a status is terminal, but a TCP server that
 *   accepts the connection without ever finishing the WebSocket handshake
 *   sends no terminal status at all — and there is no timer anywhere on this
 *   page to notice one is overdue (spec: no gratuitous timers). That socket
 *   had no way to close, ever.
 *
 * `run()` folds both into one rule: a click while a probe is already running
 * closes that one rather than opening a second one beside it — which also
 * means a hung probe is exactly one more click from being cleaned up. The
 * click after that gets a genuinely fresh attempt.
 */
export function createObsProbe(deps: {
  /**
   * Read fresh on every `run()`, never cached: credentials may have changed
   * since the last click, and a stale factory would test last time's
   * password.
   */
  connectOptions(): Pick<ObsClientOptions, 'url' | 'password' | 'socketFactory'>;
  onStatus(status: ObsProbeStatus | null): void;
}): { run(): void } {
  let current: ObsClient | null = null;

  return {
    run() {
      if (current) {
        current.close();
        current = null;
        deps.onStatus(null);
        return;
      }

      // The first terminal status wins, and nothing after it counts. `close()`
      // below is not neutral — it reports 'idle', which would otherwise come
      // straight back into this handler and overwrite the answer just
      // recorded.
      let answered = false;
      const client = createObsClient({
        ...deps.connectOptions(),
        onStatus: (status) => {
          if (answered || status === 'connecting') return;
          answered = true;
          current = null;
          // Closed on the spot: nothing is ever sent through this one, and
          // leaving it open would show a second client in OBS for good.
          client.close();
          if (status === 'idle') return;
          deps.onStatus(status);
        },
        onMessage: () => {},
      });
      current = client;
      deps.onStatus('testing');
      client.connect();
    },
  };
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
 * The throughput pill, or `null` when its figure could only be zero.
 *
 * Same reasoning as `overlayTally`, and the same shape: the rate counts frames
 * leaving for OBS, and the page zeroes it itself the moment the socket stops
 * being identified (`App.svelte`). With OBS down, «0 fps» is not a measurement
 * — it is a constant, printed beside a dot that has already said the link is
 * dead. A number above zero is still shown, so the transient between the socket
 * dropping and the reset never reads as the stream having stopped on its own.
 */
export function rateLabel(rate: number, obsConnected: boolean): string | null {
  if (!obsConnected && rate === 0) return null;
  return `${rate} fps`;
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
