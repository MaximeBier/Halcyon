import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Wizard from './Wizard.svelte';
import wizardSource from './Wizard.svelte?raw';
import type { WizardStep } from './wizard';
import type { KeyboardStatus } from '../keyboard/device';
import type { ObsStatus } from '../transport/obs';

afterEach(cleanup);
// A stub left in place after a failing assertion leaks into every test that
// runs after it — `navigator` would stay swapped out for good. Cleaning it up
// inline, at the end of the test that stubs it, only runs when that test's
// assertions all pass.
afterEach(() => vi.unstubAllGlobals());

function wizard(step: WizardStep, overrides: Record<string, unknown> = {}) {
  const handlers = { onAllowKeyboard: vi.fn(), onReconnect: vi.fn(), onSkip: vi.fn() };
  const props = {
    step,
    keyboard: 'disconnected' as KeyboardStatus,
    device: null,
    obs: 'idle' as ObsStatus,
    overlaysInObs: 0,
    settings: { port: 4455, password: 'hunter2' },
    url: 'https://halcyon.example/overlay.html?port=4455#password=hunter2',
    ...handlers,
    ...overrides,
  };
  return { ...render(Wizard, { props }), ...handlers };
}

const card = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-card]')!;
/** What the status line says of a refused password. */
const refusal = (c: HTMLElement) =>
  c.querySelector('[data-obs-line] .line.wrong')?.textContent?.trim() ?? null;
const row = (c: HTMLElement, step: string) => c.querySelector<HTMLElement>(`[data-row="${step}"]`)!;
const button = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);

describe('the rail', () => {
  it('threads the three steps, and marks where one stands', () => {
    const { container } = wizard('obs', { keyboard: 'connected', device: 'Wooting 60HE' });

    expect(row(container, 'keyboard').dataset.state).toBe('done');
    expect(row(container, 'obs').dataset.state).toBe('current');
    expect(row(container, 'keys').dataset.state).toBe('pending');
  });

  it('marks each step on a thread, never with a numbered disc (board Wizard 4a)', () => {
    const { container } = wizard('obs', { keyboard: 'connected', device: 'Wooting 60HE' });
    const mark = (step: string) => row(container, step).querySelector<HTMLElement>('.mark')!;

    // Done: a check. Current and pending: a dot, filled or hollow. No figure anywhere.
    expect(mark('keyboard').querySelector('svg')).not.toBeNull();
    expect(mark('obs').querySelector('.pip')).not.toBeNull();
    expect(mark('keys').querySelector('.pip')).not.toBeNull();
    // Never the status line's amber dot, whose class it once shared.
    for (const step of ['obs', 'keys']) expect(mark(step).querySelector('.dot')).toBeNull();
    for (const step of ['keyboard', 'obs', 'keys'])
      expect(mark(step).textContent).not.toMatch(/\d/);
    // A thread under every step but the last.
    expect(row(container, 'keyboard').querySelector('.wire')).not.toBeNull();
    expect(row(container, 'obs').querySelector('.wire')).not.toBeNull();
    expect(row(container, 'keys').querySelector('.wire')).toBeNull();
  });

  it('draws the markers and the thread as the board does', () => {
    const style = (/<style>([\s\S]*?)<\/style>/.exec(wizardSource)?.[1] ?? '').replace(/\s+/g, ' ');
    expect(style).toMatch(/li\[data-state='current'\] \.pip \{[^}]*box-shadow: 0 0 0 4px/);
    expect(style).toMatch(
      /li\[data-state='pending'\] \.pip \{[^}]*border: 1\.5px solid var\(--he-border-hover\)/,
    );
    expect(style).toMatch(/li\[data-state='done'\] \.wire \{[^}]*background: var\(--he-wire-ok\)/);
    expect(style).toMatch(/\.steps li:not\(:last-child\) \{[^}]*min-block-size: 62px/);
    expect(style).toMatch(/\.wire \{[^}]*inline-size: 1px/);
    expect(style).not.toMatch(/\.bullet/);
  });

  it('names the keyboard it found, rather than only ticking it', () => {
    // A green tick says a keyboard answered, not which one — and the question
    // is asked precisely on the machine with two analog boards in it.
    const { container } = wizard('obs', { keyboard: 'connected', device: 'Wooting 60HE' });

    expect(row(container, 'keyboard').textContent).toContain('Wooting 60HE detected');
  });

  it('keeps the third step in view as the destination, in the editor', () => {
    // Board 4a: the thread shows where the setup leads, and reaching that
    // step closes the wizard — so the row says where it happens.
    const { container } = wizard('keyboard');

    expect(row(container, 'keys').textContent).toContain('Add your keys');
    expect(row(container, 'keys').textContent).toContain('in the editor');
  });

  it('says OBS is not connected yet while the keyboard is still the question', () => {
    const { container } = wizard('keyboard');

    expect(row(container, 'obs').textContent).toContain('not connected yet');
  });

  it('can be put aside from either step, from the same place', () => {
    for (const step of ['keyboard', 'obs'] as WizardStep[]) {
      const { container, onSkip } = wizard(step);

      button(container, 'skip')!.click();

      expect(onSkip).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });
});

describe('step 1 · the keyboard', () => {
  it('names the one gesture the button actually performs, whatever the status', () => {
    // "Rescan devices" promised a scan the code never runs: the click opens
    // the same HID picker `onAllowKeyboard` always opens — the very picker
    // `requestPermission()` shows, which can come back empty. One honest
    // label for every status this row is shown in, not one per status.
    for (const keyboard of [
      'no-permission',
      'disconnected',
      'no-analog-interface',
      'open-failed',
    ] as KeyboardStatus[]) {
      const { container, onAllowKeyboard } = wizard('keyboard', { keyboard });

      expect(button(container, 'keyboard')!.textContent).toContain('Choose device…');
      button(container, 'keyboard')!.click();
      expect(onAllowKeyboard).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('says what it is looking for before permission has even been asked for', () => {
    // `no-permission` is not a failure yet — nothing has been tried. The
    // automatic look is `navigator.hid.getDevices()`, which only ever returns
    // a device this site was already allowed: on a first visit it finds
    // nothing, and the line says so rather than promising a scan.
    const { container } = wizard('keyboard', { keyboard: 'no-permission' });

    expect(container.querySelector('[data-status]')!.textContent).toContain(
      'Looking for a keyboard you’ve already allowed…',
    );
    expect(row(container, 'keyboard').textContent).toContain('searching…');
  });

  // `device` stays `null` for these three statuses forever, not just until
  // something resolves — and "searching…" used to be the only word on the
  // card, with the real diagnosis stuck in a status bar a beginner never
  // looks at (spec's first documented Wooting user hit exactly this wall).
  it('names an old firmware rather than scanning forever', () => {
    const { container } = wizard('keyboard', { keyboard: 'no-analog-interface' });

    expect(container.querySelector('[data-status]')!.textContent).toMatch(/firmware/i);
    expect(container.querySelector('[data-status]')!.getAttribute('data-failed')).toBe('true');
  });

  it('says nothing is plugged in, rather than scanning forever', () => {
    const { container } = wizard('keyboard', { keyboard: 'disconnected' });

    expect(container.querySelector('[data-status]')!.textContent).toMatch(/plug/i);
  });

  it('names another app holding the device, rather than scanning forever', () => {
    const { container } = wizard('keyboard', { keyboard: 'open-failed' });

    expect(container.querySelector('[data-status]')!.textContent).toMatch(/wootility|try again/i);
  });
});

describe('step 2 · OBS', () => {
  it('tells where the password is shown in OBS', () => {
    // The generated password hides behind "Show Connect Info", and the step
    // used to send people looking for it in the settings dialog.
    expect(card(wizard('obs').container).textContent).toContain('Show Connect Info');
  });

  it('hands over the URL to paste into OBS, and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { container } = wizard('obs');

    // A value to copy, not a field: no border, no caret, no focus of its own.
    const value = container.querySelector<HTMLElement>('[data-url]')!;
    expect(value.tagName).toBe('OUTPUT');
    expect(value.textContent).toContain('overlay.html');
    expect(value.getAttribute('aria-label')).toBe('Overlay URL for OBS');
    expect(value.classList).toContain('he-copy-value');
    expect(value.hasAttribute('tabindex')).toBe(false);
    button(container, 'copy')!.click();
    await tick();

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('overlay.html'));
  });

  it('asks for a reconnect when a credential changes', async () => {
    // Credentials are read once when the socket opens: a new port has to
    // rebuild the client, not patch it.
    const { container, onReconnect } = wizard('obs');
    const port = container.querySelector<HTMLInputElement>('input[type="number"]')!;

    port.value = '4456';
    port.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('says the password never leaves the machine', () => {
    // The one page that hands out a URL with a password in it owes the reader
    // this sentence (spec §16.8).
    expect(card(wizard('obs').container).textContent).toContain(
      'The password never leaves your computer.',
    );
  });

  it('waits for OBS out loud before anything was tried', () => {
    const { container } = wizard('obs', { keyboard: 'connected' });

    expect(container.querySelector('[data-obs-line]')!.textContent).toContain('Waiting for OBS');
    expect(row(container, 'obs').textContent).toContain('waiting…');
  });

  it('says nothing of a password nobody has typed yet', () => {
    // On a first arrival the connection tries an empty password and OBS
    // refuses it: no verdict before there was an attempt.
    const { container } = wizard('obs', {
      keyboard: 'connected',
      obs: 'auth-failed',
      settings: { port: 4455, password: '' },
    });

    expect(container.querySelector('[data-error]')).toBeNull();
    expect(container.querySelector('.secret.refused')).toBeNull();
    expect(container.textContent).not.toContain('Wrong password');
  });

  it('says it once something was typed into the field', async () => {
    const { container } = wizard('obs', {
      keyboard: 'connected',
      obs: 'auth-failed',
      settings: { port: 4455, password: '' },
    });
    const field = container.querySelector<HTMLInputElement>('.secret input')!;

    field.value = 'nope';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(refusal(container)).toBe('Wrong password');
    expect(container.querySelector('.secret.refused')).not.toBeNull();
  });

  it('says a refused password in the status line, the field framed red and pointing to it', () => {
    // Board Wizard 4a: under the field, only its help sentence, whatever happens.
    const { container } = wizard('obs', { keyboard: 'connected', obs: 'auth-failed' });
    const field = container.querySelector<HTMLInputElement>('.secret input')!;
    const line = container.querySelector<HTMLElement>('[data-obs-line] .line')!;

    expect(container.querySelector('[data-error]')).toBeNull();
    expect(container.querySelector('.secret.refused')).not.toBeNull();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(line.id);
    expect(line.textContent!.trim()).toBe('Wrong password');
    expect(line.classList).toContain('wrong');
    expect(row(container, 'obs').textContent).toContain('Wrong password');
    // The help sentence stays, refused or not.
    expect(container.querySelector('.password .he-help')!.textContent).toContain(
      'The password never leaves your computer.',
    );
  });

  it('draws its status line on a layer of its own, so its text never changes look', () => {
    // The blinking caret's layer took the line in on focus, and Chrome drew
    // its red words with grey antialiasing instead of ClearType: they looked
    // to lose their weight. On its own layer, it is drawn the one way.
    const style = (/<style>([\s\S]*?)<\/style>/.exec(wizardSource)?.[1] ?? '').replace(/\s+/g, ' ');
    expect(/\.foot \{([^}]*)\}/.exec(style)![1]).toMatch(/will-change: transform/);
  });

  it('marks the field valid while nothing was refused', () => {
    const { container } = wizard('obs', { keyboard: 'connected', obs: 'connecting' });
    const field = container.querySelector<HTMLInputElement>('.secret input')!;
    expect(field.hasAttribute('aria-invalid')).toBe(false);
    expect(container.querySelector('[data-obs-line] .line.wrong')).toBeNull();
  });

  it('gives the silent server the full sentence, site settings included', () => {
    // Two dead ends hide behind `unreachable` and neither announces itself:
    // the WebSocket server is off, or Chrome's local network access was
    // refused — once, silently, for good until site settings lift it.
    const { container } = wizard('obs', { keyboard: 'connected', obs: 'unreachable' });

    expect(container.querySelector('[data-obs-line]')!.textContent).toMatch(/websocket server/i);
    expect(container.querySelector('[data-obs-line]')!.textContent).toMatch(/site settings/i);
    expect(container.querySelector('[data-error]')).toBeNull();
  });

  it('says the socket is up but nothing inside OBS listens yet', () => {
    const { container } = wizard('obs', {
      keyboard: 'connected',
      obs: 'identified',
      overlaysInObs: 0,
    });

    expect(container.querySelector('[data-obs-line]')!.textContent).toContain(
      'Connected. Waiting for the browser source.',
    );
  });
});

describe('what is still going on', () => {
  // The page's one figure for "in progress" (spec §16.13): a muted dot that
  // pulses. Never amber — amber means something to look at.
  const dot = (c: HTMLElement, where: string) => c.querySelector(`${where} .dot`)!;

  it('pulses while it looks for the keyboard, not once it has failed', () => {
    const looking = wizard('keyboard', { keyboard: 'no-permission' });
    expect(dot(looking.container, '[data-status]').classList.contains('he-pulse')).toBe(true);
    cleanup();

    const failed = wizard('keyboard', { keyboard: 'open-failed' });
    expect(dot(failed.container, '[data-status]').classList.contains('he-pulse')).toBe(false);
  });

  it('pulses while it waits for OBS, not once OBS answers', () => {
    const waiting = wizard('obs', { obs: 'idle' });
    expect(dot(waiting.container, '[data-obs-line]').classList.contains('he-pulse')).toBe(true);
    cleanup();

    const connecting = wizard('obs', { obs: 'connecting' });
    expect(dot(connecting.container, '[data-obs-line]').classList.contains('he-pulse')).toBe(true);
    cleanup();

    const live = wizard('obs', { obs: 'identified', overlaysInObs: 1 });
    expect(dot(live.container, '[data-obs-line]').classList.contains('he-pulse')).toBe(false);
    expect(dot(live.container, '[data-obs-line]').classList.contains('live')).toBe(true);
  });

  it('puts a fixed red dot on an error, never amber (board System)', () => {
    const style = (/<style>([\s\S]*?)<\/style>/.exec(wizardSource)?.[1] ?? '').replace(/\s+/g, ' ');
    // The base dot is what an error shows: OBS silent, closed, the password refused.
    expect(/ \.dot \{([^}]*)\}/.exec(style)![1]).toMatch(/background: var\(--he-danger\)/);
    expect(style).not.toMatch(/--he-warn/);
    for (const obs of ['unreachable', 'disconnected', 'auth-failed'] as const) {
      const { container } = wizard('obs', { obs });
      const d = dot(container, '[data-obs-line]');
      expect(d.classList.contains('he-pulse') || d.classList.contains('live')).toBe(false);
      cleanup();
    }
  });
});

describe('the setup, retouched (spec §16.8, 2026-11-06)', () => {
  it('makes Choose device the primary button of step 1', () => {
    // On a first visit it is the only gesture that moves the setup on.
    const { container } = wizard('keyboard', { keyboard: 'no-permission' });

    expect(button(container, 'keyboard')!.classList.contains('he-btn-primary')).toBe(true);
  });

  it('numbers the three things to do as a plain list: "1." in mono, no disc', () => {
    // Prototype, board Wizard 4a · étape 2.
    const { container } = wizard('obs');
    const nums = [...container.querySelectorAll('[data-obs-steps] .num')].map((n) => n.textContent);
    expect(nums).toEqual(['1.', '2.', '3.']);
    const style = (/<style>([\s\S]*?)<\/style>/.exec(wizardSource)?.[1] ?? '').replace(/\s+/g, ' ');
    expect(style).toMatch(/\.todo li \{[^}]*align-items: baseline/);
    const num = /\.num \{([^}]*)\}/.exec(style)![1]!;
    expect(num).toMatch(/inline-size: 18px/);
    expect(num).toMatch(/text-align: right/);
    expect(num).toMatch(/font: var\(--he-font-mono\)/);
    expect(num).not.toMatch(/border/);
  });

  it('numbers the three things to do in OBS', () => {
    const { container } = wizard('obs');
    const steps = [...container.querySelectorAll('[data-obs-steps] li')].map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );

    expect(steps).toHaveLength(3);
    // Names of things in OBS between curly quotes, in the sentence's colour
    // and weight: no bold, no white (board System).
    expect(steps).toEqual([
      '1. In OBS, open “Tools → WebSocket Server Settings”, then tick “Enable WebSocket server” and “Enable Authentication”.',
      '2. Click “Show Connect Info” and paste the password below.',
      '3. Add a “Browser” source to your scene with the URL below.',
    ]);
    expect(container.querySelector('[data-obs-steps] strong')).toBeNull();
  });

  it('titles the URL for what it is in OBS', () => {
    const { container } = wizard('obs');

    expect(container.querySelector('.caption')!.textContent).toBe('Browser source URL');
  });

  it('gives the size of the source under its URL, as the stage foot does', () => {
    const { container } = wizard('obs', { size: { width: 216, height: 216 } });

    expect(
      container.querySelector('[data-source-size]')!.textContent!.replace(/\s+/g, ' ').trim(),
    ).toBe('Width 216 · Height 216');
  });

  it('gives no size before there is a key to size', () => {
    // An empty layout is 0 × 0: a figure nobody could type into OBS.
    const { container } = wizard('obs', { size: null });

    expect(container.querySelector('[data-source-size]')).toBeNull();
  });
});
