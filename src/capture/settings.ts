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
      return 'Device refused to open. Close Wootility, then try again.';
    case 'unsupported':
      return 'WebHID is required. Use Chrome or Edge on desktop.';
  }
}

/**
 * The keyboard pill (boards 3a, Editor-StatusPills): the device's own name
 * once it answers, two or three words otherwise — never the gesture, which
 * is the tooltip's (`keyboardTip`). One form for every state since
 * 2026-11-06, so the header's width moves as little as the news does.
 *
 * The name is WebHID's `productName` — "Wooting 60HE+", not "Keyboard" — so
 * the pill says which one, which matters the day two are plugged in. The full
 * sentence, firmware or Wootility advice included, stays in the setup's gate
 * (`keyboardHint`).
 */
export function keyboardPill(status: KeyboardStatus, device: string | null): string {
  switch (status) {
    case 'connected':
      return device ?? 'Keyboard';
    case 'no-permission':
    case 'disconnected':
      return 'No keyboard';
    case 'no-analog-interface':
      return 'No analog interface';
    case 'open-failed':
      return 'Keyboard busy';
    case 'unsupported':
      return 'WebHID required';
  }
}

/**
 * What the keyboard pill's click does, on hover (board Editor-StatusPills).
 * Connected, it offers another keyboard and does not repeat the name: cut by
 * a narrow header, the pill is not spelled out whole elsewhere. Where the
 * click is not the whole answer — a firmware, Wootility holding the device —
 * the sentence names it first.
 */
export function keyboardTip(status: KeyboardStatus): string {
  switch (status) {
    case 'connected':
      return 'Choose another keyboard';
    case 'no-permission':
    case 'disconnected':
      return 'Click to choose a keyboard';
    case 'no-analog-interface':
      return 'Update the firmware in Wootility, or click to pick another device';
    case 'open-failed':
      return 'Close Wootility or other tabs using the keyboard, then click to retry';
    case 'unsupported':
      return 'Use Chrome or Edge on desktop';
  }
}

/**
 * Whether the keyboard pill is worth clicking — the device picker as its own
 * gesture (spec §11).
 *
 * Since board 3a the connected pill is a button too, and for the same
 * gesture: the picker is how one swaps to the other keyboard on the desk.
 * This predicate still answers a narrower question — is something *wrong*
 * that a picker could fix — which is what colours the pill red.
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
 * The one OBS pill of board `3a`, which replaced three (state, tally,
 * throughput) on 2026-09-05; one short form since 2026-11-06 (board
 * Editor-StatusPills).
 *
 * Connected, it says "OBS" and nothing more, and the header stops changing
 * width with every frame rate. Not connected, it carries no figure
 * either — every heartbeat rides the OBS socket, so both would be constants.
 * Both states the click retries read "disconnected" (`canRetryObs`); what the
 * click does is the tooltip's (`obsTip`), and the full sentence with what to
 * do about it (`obsHint`) waits in the pill's popover.
 */
export function obsPill(status: ObsStatus): string {
  switch (status) {
    case 'identified':
      return 'OBS';
    case 'connecting':
      return 'OBS connecting…';
    case 'auth-failed':
      return 'OBS password refused';
    case 'unreachable':
    case 'disconnected':
      return 'OBS disconnected';
    case 'idle':
      return 'OBS not connected';
  }
}

/**
 * What the OBS pill's click does, on hover, or `null` where it only opens the
 * popover the pill already promises: connected, connecting, not yet tried.
 */
export function obsTip(status: ObsStatus): string | null {
  switch (status) {
    case 'unreachable':
    case 'disconnected':
      return 'Click to reconnect';
    case 'auth-failed':
      return 'Click to check the password';
    case 'identified':
    case 'connecting':
    case 'idle':
      return null;
  }
}

/**
 * What the status bar says when a second capture page is on the bus, or `null`
 * when this one is alone.
 *
 * No number in it. One is knowable since the pages say `gone` as they leave,
 * but the instruction is the same for one rival and for five, and a figure
 * would only invite someone to reconcile it against their tabs. The plural is
 * worn by the instruction instead, where it costs nothing to be right.
 *
 * One step, since 2026-09-15. It used to end with "then reload": reloading
 * resent this configuration, which is what takes the overlay back, and it was
 * the only thing that cleared a warning which never lifted on its own. Now the
 * page hears the last rival leave, resends by itself and lifts the warning
 * (see `ConfigBroadcaster.hasOtherCapture`) — closing is the one step it
 * cannot do for anyone.
 */
export function captureWarning(another: boolean): string | null {
  if (!another) return null;
  // One pill among the others since 2026-09-05, no longer a line of its own,
  // so it is cut to what fits in a run.
  return 'Other capture pages open';
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
  if (counts.inObs > 0) return 'Overlay connected in OBS';
  if (counts.inBrowser > 0) return 'Only a browser tab is listening · no source in OBS yet';
  return 'No overlay has reported in yet';
}
