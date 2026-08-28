/**
 * The logic of the "Start with Windows" guide, without its popover.
 *
 * The capture page already survives being opened with nothing attached:
 * `resume()` takes the keyboard back without a gesture, the OBS password is
 * read from storage, and the client retries until OBS answers. What the guide
 * teaches is therefore only how to make Windows *open the page* — install it
 * as an app, tick the browser's run-on-login option — and the states here are
 * where the reader stands on that path.
 */

export type InstallState = 'standalone' | 'installed' | 'installable' | 'manual';

/**
 * Where the install step stands, derived from the state every time — the same
 * reasoning as the wizard's `nextStep`: never a flag that only moves forward.
 *
 * `standalone` outranks `installed` outranks `installable`: being inside the
 * app window is the step done regardless of what fired on the way, and an
 * `appinstalled` seen from the old tab outranks whatever prompt that tab still
 * holds.
 */
export function installState(input: {
  /** `(display-mode: standalone)` — the page runs in the installed window. */
  standalone: boolean;
  /** `appinstalled` fired: the install happened, but this tab stayed a tab. */
  installed: boolean;
  /** A `beforeinstallprompt` is captured and waiting for the button. */
  promptAvailable: boolean;
}): InstallState {
  if (input.standalone) return 'standalone';
  if (input.installed) return 'installed';
  return input.promptAvailable ? 'installable' : 'manual';
}

export type BrowserFlavor = 'edge' | 'chrome';

/**
 * Edge or everything else. WebHID already narrows the field to Chromium, and
 * the Chromium forks answer to the Chrome instructions — Edge is the one that
 * renamed both the apps page and the toggle.
 */
export function browserFlavor(userAgent: string): BrowserFlavor {
  return userAgent.includes('Edg/') ? 'edge' : 'chrome';
}

export interface AutostartPath {
  /** Shown with a copy button, never as a link: pages may not link to chrome://. */
  address: string;
  instruction: string;
}

export function autostartPath(flavor: BrowserFlavor): AutostartPath {
  return flavor === 'edge'
    ? {
        address: 'edge://apps',
        instruction: 'open Halcyon’s details and turn on “Auto-start on device login”.',
      }
    : {
        address: 'chrome://apps',
        instruction: 'right-click Halcyon and tick “Start app when you sign in”.',
      };
}

/** The install step's line for the states where a button is not the answer. */
export function installHint(state: InstallState): string | null {
  switch (state) {
    case 'installable':
      return null;
    case 'standalone':
      return 'You are in the installed app.';
    case 'installed':
      return 'Installed — Halcyon has its own window now.';
    case 'manual':
      return 'Use the install icon at the right end of the address bar.';
  }
}
