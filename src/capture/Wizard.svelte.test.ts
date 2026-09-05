import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Wizard from './Wizard.svelte';
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

  it('says it is scanning before permission has even been asked for', () => {
    // `no-permission` is not a failure yet — nothing has been tried.
    const { container } = wizard('keyboard', { keyboard: 'no-permission' });

    expect(container.querySelector('[data-status]')!.textContent).toContain('Scanning devices…');
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

    expect(container.querySelector<HTMLInputElement>('[data-url]')!.value).toContain(
      'overlay.html',
    );
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

  it('puts a refused password under the field it was typed into', () => {
    // The correction appears where the mistake was made, not in a header pill
    // a beginner never looks at.
    const { container } = wizard('obs', { keyboard: 'connected', obs: 'auth-failed' });

    expect(container.querySelector('[data-error]')!.textContent).toContain('password refused');
    expect(row(container, 'obs').textContent).toContain('password refused');
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
      'waiting for the browser source',
    );
  });
});
