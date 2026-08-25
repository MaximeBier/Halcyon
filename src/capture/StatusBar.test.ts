import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import StatusBar from './StatusBar.svelte';
import type { KeyboardStatus } from '../keyboard/device';
import type { ObsStatus } from '../transport/obs';

afterEach(cleanup);

function bar(overrides: { keyboard?: KeyboardStatus; obs?: ObsStatus } = {}) {
  const handlers = { onPickDevice: vi.fn(), onRetryObs: vi.fn() };
  const props = {
    keyboard: 'connected' as KeyboardStatus,
    obs: 'identified' as ObsStatus,
    rate: 58,
    overlays: { inObs: 1, inBrowser: 0 },
    otherCapture: false,
    ...handlers,
    ...overrides,
  };
  return { ...render(StatusBar, { props }), ...handlers };
}

const pill = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLElement>(`[data-pill="${name}"]`)!;

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

  it('retries the socket from the OBS pill', async () => {
    const { container, onRetryObs } = bar({ obs: 'unreachable' });

    await fireEvent.click(pill(container, 'obs'));

    expect(onRetryObs).toHaveBeenCalledTimes(1);
  });
});

describe('a pill with nothing to offer', () => {
  it('is not a button when the keyboard works', () => {
    // A button that does nothing is worse than plain text: it invites a click
    // and answers with silence.
    const { container } = bar({ keyboard: 'connected' });

    expect(pill(container, 'keyboard').tagName).not.toBe('BUTTON');
  });

  it('is not a button on a browser with no WebHID at all', () => {
    const { container } = bar({ keyboard: 'unsupported' });

    expect(pill(container, 'keyboard').tagName).not.toBe('BUTTON');
  });

  it('is not a button when OBS is connected, or when the password was refused', () => {
    for (const obs of ['identified', 'auth-failed'] as ObsStatus[]) {
      const { container } = bar({ obs });

      expect(pill(container, 'obs').tagName).not.toBe('BUTTON');
      cleanup();
    }
  });

  it('leaves the two measures as plain text', () => {
    // They report, they do not ask. Nothing about a frame rate is actionable.
    const { container } = bar();

    expect(pill(container, 'rate').tagName).not.toBe('BUTTON');
    expect(pill(container, 'overlays').tagName).not.toBe('BUTTON');
  });
});
