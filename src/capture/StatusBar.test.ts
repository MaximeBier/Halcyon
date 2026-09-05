import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import StatusBar from './StatusBar.svelte';
import type { KeyboardStatus } from '../keyboard/device';
import type { ObsStatus } from '../transport/obs';

afterEach(cleanup);

function bar(overrides: { keyboard?: KeyboardStatus; obs?: ObsStatus } = {}) {
  const handlers = {
    onPickDevice: vi.fn(),
    onRetryObs: vi.fn(),
    onCopyUrl: vi.fn(() => Promise.resolve(true)),
  };
  const props = {
    keyboard: 'connected' as KeyboardStatus,
    device: 'Wooting 60HE+',
    obs: 'identified' as ObsStatus,
    rate: 58,
    overlays: { inObs: 1, inBrowser: 0 },
    otherCapture: false,
    url: 'http://localhost:5173/overlay.html?port=4455',
    size: { width: 216, height: 216 },
    settings: { port: 4455, password: 'secret' },
    ...handlers,
    ...overrides,
  };
  return { ...render(StatusBar, { props }), ...handlers };
}

const pill = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLElement>(`[data-pill="${name}"]`)!;
const popover = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-obs-popover]');

describe('a pill that can fix what it reports', () => {
  it('opens the device picker from the keyboard pill itself', async () => {
    // The whole pill, dot and sentence together — the target is the thing the
    // reader is already looking at, not a button elsewhere on the page.
    const { container, onPickDevice } = bar({ keyboard: 'no-permission' });

    await fireEvent.click(pill(container, 'keyboard'));

    expect(onPickDevice).toHaveBeenCalledTimes(1);
  });

  it('offers the picker for a keyboard that is unplugged or has no analog interface', () => {
    for (const keyboard of ['disconnected', 'no-analog-interface'] as KeyboardStatus[]) {
      const { container } = bar({ keyboard });

      expect(pill(container, 'keyboard').tagName).toBe('BUTTON');
      cleanup();
    }
  });

  it('retries the socket from the OBS pill while OBS is down, and opens nothing', async () => {
    for (const obs of ['unreachable', 'disconnected'] as ObsStatus[]) {
      const { container, onRetryObs } = bar({ obs });

      await fireEvent.click(pill(container, 'obs'));

      expect(onRetryObs).toHaveBeenCalledTimes(1);
      expect(popover(container)).toBeNull();
      cleanup();
    }
  });
});

describe('the keyboard pill', () => {
  it('names the device that answered', () => {
    // WebHID's product name, not "Keyboard": the day two are plugged in, the
    // pill says which one is speaking (board 3a).
    const { container } = bar({ keyboard: 'connected' });

    expect(pill(container, 'keyboard').textContent).toContain('Wooting 60HE+');
  });

  it('reopens the picker from the connected pill, to swap keyboards', async () => {
    const { container, onPickDevice } = bar({ keyboard: 'connected' });

    expect(pill(container, 'keyboard').tagName).toBe('BUTTON');
    await fireEvent.click(pill(container, 'keyboard'));

    expect(onPickDevice).toHaveBeenCalledTimes(1);
  });

  it('keeps the full sentence within reach, on the tooltip', () => {
    // The pill is cut down to the gesture; the firmware and Wootility advice
    // still has to be findable from the pill itself.
    const { container } = bar({ keyboard: 'no-analog-interface' });

    expect(pill(container, 'keyboard').textContent).toContain('click');
    expect(pill(container, 'keyboard').getAttribute('title')).toMatch(/wootility/i);
  });

  it('is not a button on a browser with no WebHID at all', () => {
    // A button that does nothing is worse than plain text: it invites a click
    // and answers with silence — and there is no picker to open here.
    const { container } = bar({ keyboard: 'unsupported' });

    expect(pill(container, 'keyboard').tagName).not.toBe('BUTTON');
  });
});

describe('the one OBS pill', () => {
  it('folds the state, the tally and the rate into one line', () => {
    const { container } = bar();

    expect(pill(container, 'obs').textContent).toContain('OBS · 1 overlay · 58 fps');
    expect(container.querySelector('[data-pill="rate"]')).toBeNull();
    expect(container.querySelector('[data-pill="overlays"]')).toBeNull();
  });

  it('opens the popover on a click once connected', async () => {
    // Nothing to retry: the click is the door to the URL, the size and the
    // credentials, which the sidebar no longer carries (board 3a).
    const { container, onRetryObs } = bar({ obs: 'identified' });

    await fireEvent.click(pill(container, 'obs'));

    expect(popover(container)).not.toBeNull();
    expect(onRetryObs).not.toHaveBeenCalled();
    expect(pill(container, 'obs').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the popover on a click when the password was refused', async () => {
    // Another identical attempt would fail identically; the field is what
    // this state wants, and the popover is where it is.
    const { container, onRetryObs } = bar({ obs: 'auth-failed' });

    await fireEvent.click(pill(container, 'obs'));

    expect(popover(container)).not.toBeNull();
    expect(onRetryObs).not.toHaveBeenCalled();
  });

  it('reaches the popover on a right click while OBS is down', async () => {
    // The click is the retry then, so the credentials need another gesture —
    // and a wrong port is exactly what makes OBS unreachable.
    const { container, onRetryObs } = bar({ obs: 'unreachable' });

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pill(container, 'obs').dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(popover(container)).not.toBeNull();
    expect(onRetryObs).not.toHaveBeenCalled();
  });

  it('closes on Escape and hands the focus back to the pill', async () => {
    const { container } = bar();
    await fireEvent.click(pill(container, 'obs'));
    expect(document.activeElement).toBe(popover(container));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();

    expect(popover(container)).toBeNull();
    expect(document.activeElement).toBe(pill(container, 'obs'));
  });

  it('closes on a click outside, and stays on a click inside', async () => {
    const { container } = bar();
    await fireEvent.click(pill(container, 'obs'));

    popover(container)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(popover(container)).not.toBeNull();

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(popover(container)).toBeNull();
  });

  it('hands a changed credential to the same retry the pill uses', async () => {
    // The fold's rule, kept: credentials are read once when the socket opens,
    // so a new port or password has to rebuild the client, not patch it.
    const { container, onRetryObs } = bar();
    await fireEvent.click(pill(container, 'obs'));

    const port = popover(container)!.querySelector<HTMLInputElement>('input[type="number"]')!;
    port.value = '4456';
    await fireEvent.change(port);

    expect(onRetryObs).toHaveBeenCalledTimes(1);
  });
});
