import type { KeyboardStatus } from '../keyboard/device';
import type { ObsStatus } from '../transport/obs';

const KEY = 'he-overlay:setup';

/**
 * Where the setup stands, in the order the mockup walks it (boards 6a–6c).
 *
 * **Keyboard, then OBS, then keys** — not keyboard, keys, OBS as the plan first
 * had it. The order matters: with the overlay already live and empty, every key
 * learned in step 3 appears in OBS the instant it is added, so the last step
 * proves itself. The other way round, the wizard ends on a blank wait for
 * something to report in, which is the one moment a beginner cannot tell a
 * slow connection from a wrong URL.
 */
export type WizardStep = 'keyboard' | 'obs' | 'keys' | 'done';

/** Open, put aside, or seen through. Only `open` puts the card on the stage. */
export type WizardStatus = 'open' | 'skipped' | 'done';

export interface SetupState {
  keyboard: KeyboardStatus;
  obs: ObsStatus;
  /**
   * Overlays reporting in **from inside OBS**, and not the total.
   *
   * Named for the half it needs rather than for the thing it counts: the
   * caller holds two figures since task 30, and the field was called
   * `overlays` while the wizard was handed their sum. A tab opened to check
   * the overlay works then cleared this step permanently.
   */
  overlaysInObs: number;
  keyCount: number;
}

/**
 * What is left to do, derived from the state every single time.
 *
 * Never a counter that only moves forward: that would claim the setup was done
 * for someone whose keyboard was unplugged halfway. It is the *status* that
 * sticks, not the step — which is what keeps a finished install from reopening
 * the wizard the next time OBS is restarted.
 */
export function nextStep(state: SetupState): WizardStep {
  if (state.keyboard !== 'connected') return 'keyboard';
  // The socket is the easy half. The half that fails in silence is the browser
  // source: a correct URL never pasted into OBS looks exactly like a wrong one.
  // Step 2 is not cleared until something on the other side reports in.
  if (state.obs !== 'identified' || state.overlaysInObs === 0) return 'obs';
  if (state.keyCount === 0) return 'keys';
  return 'done';
}

const ORDER: WizardStep[] = ['keyboard', 'obs', 'keys'];

/** For the header's "Resume setup · N/3". A finished setup is 3, never 4. */
export function stepNumber(step: WizardStep): number {
  const at = ORDER.indexOf(step);
  return at < 0 ? ORDER.length : at + 1;
}

export function showsWizard(status: WizardStatus, step: WizardStep): boolean {
  return status === 'open' && step !== 'done';
}

export function showsResume(status: WizardStatus, step: WizardStep): boolean {
  return status === 'skipped' && step !== 'done';
}

const STATUSES: readonly string[] = ['open', 'skipped', 'done'];

export function loadStatus(storage: Pick<Storage, 'getItem'>): WizardStatus {
  const stored = storage.getItem(KEY);
  // Anything unrecognised opens the wizard rather than hiding it: the failure
  // to avoid is someone left with no keyboard, no wizard and no clue, over a
  // storage key they never touched on purpose.
  return stored !== null && STATUSES.includes(stored) ? (stored as WizardStatus) : 'open';
}

export function saveStatus(storage: Pick<Storage, 'setItem'>, status: WizardStatus): void {
  try {
    storage.setItem(KEY, status);
  } catch {
    // Same bargain as everywhere else: a browser that refuses to write costs
    // the wizard reappearing on the next reload, not the page failing to load.
  }
}

/**
 * What the setup card's OBS row admits to, while the step is current.
 *
 * Three different failures used to share one "waiting…": a refused password,
 * a server that never answered, and a URL never pasted into OBS. The header
 * pill distinguished them all along, but the person mid-setup is looking at
 * the card — the correction has to appear where the mistake was typed.
 *
 * Short fragments rather than `obsHint`'s full sentences, on purpose: the
 * note sits on the right edge of a row inside a 470 px card, where a sentence
 * wraps and buries the verdict. The hint keeps the paragraph; the row gets
 * the diagnosis and the one gesture that moves it.
 */
export function obsNote(status: ObsStatus, overlaysInObs: number): string {
  switch (status) {
    case 'identified':
      // The socket is the easy half (see nextStep): once it is up, the only
      // thing left to say is which half of the step is still missing.
      return overlaysInObs > 0 ? 'connected' : 'connected · waiting for the browser source';
    case 'connecting':
      return 'connecting…';
    case 'auth-failed':
      return 'password refused · check it above';
    case 'unreachable':
      // The retry rides on keyboard reports (spec §2.2): with step 1 behind,
      // a keystroke is always available — and nothing moves without one.
      return 'not answering · press a key to retry';
    case 'disconnected':
      return 'connection closed · press a key to reconnect';
    case 'idle':
      return 'waiting…';
  }
}
