import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import StatusBar from './StatusBar.svelte';
import statusSource from './StatusBar.svelte?raw';
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
    overlays: { inObs: 1, inBrowser: 0 },
    otherCapture: false,
    url: 'http://localhost:5173/overlay.html?port=4455',
    size: { width: 216, height: 216 },
    settings: { port: 4455, password: 'secret' },
    sources: 1,
    onReloadSources: vi.fn(() => Promise.resolve(1)),
    ...handlers,
    ...overrides,
  };
  return { ...render(StatusBar, { props }), ...handlers };
}

function baseProps() {
  return {
    keyboard: 'connected' as KeyboardStatus,
    device: 'Wooting 60HE+',
    obs: 'identified' as ObsStatus,
    overlays: { inObs: 1, inBrowser: 0 },
    otherCapture: false,
    url: 'http://localhost:5173/overlay.html?port=4455',
    size: { width: 216, height: 216 },
    settings: { port: 4455, password: 'secret' },
    sources: 1,
    onPickDevice: vi.fn(),
    onRetryObs: vi.fn(),
    onCopyUrl: vi.fn(() => Promise.resolve(true)),
    onReloadSources: vi.fn(() => Promise.resolve(1)),
  };
}

const pill = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLElement>(`[data-pill="${name}"]`)!;
/** The page's tooltip around a pill, if it has one. */
const tip = (el: HTMLElement) =>
  el.closest('[data-tooltip-host]')?.querySelector('[role="tooltip"]')?.textContent ?? null;
const popover = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-obs-popover]');

describe('the OBS popover, anchored to what opened it', () => {
  it('hangs under the pill when the pill opened it, and closes on Escape', async () => {
    const { container, rerender } = render(StatusBar, { props: baseProps() });
    expect(popover(container)).toBeNull();

    await rerender({ ...baseProps(), obsOpen: 'pill' });
    expect(popover(container)).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(popover(container)).toBeNull();
  });

  it('leaves it to the ⚙ when Settings › OBS connection opened it', async () => {
    // Under the gear, where the click was — not at the other end of the header.
    const { container } = render(StatusBar, { props: { ...baseProps(), obsOpen: 'settings' } });
    expect(popover(container)).toBeNull();
  });

  it('takes it under the pill from the pill’s own click, wherever it was', async () => {
    const { container } = render(StatusBar, { props: { ...baseProps(), obsOpen: 'settings' } });
    await fireEvent.click(pill(container, 'obs'));
    expect(popover(container)).not.toBeNull();
  });
});

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

  it('keeps the gesture and the advice within reach, on the tooltip', () => {
    // The pill is cut down to its state (board Editor-StatusPills); the
    // firmware and Wootility advice is the page's tooltip, never a title.
    const { container } = bar({ keyboard: 'no-analog-interface' });

    expect(pill(container, 'keyboard').textContent!.trim()).toBe('No analog interface');
    expect(pill(container, 'keyboard').hasAttribute('title')).toBe(false);
    expect(tip(pill(container, 'keyboard'))).toMatch(/wootility/i);
  });

  it('is not a button on a browser with no WebHID at all', () => {
    // A button that does nothing is worse than plain text: it invites a click
    // and answers with silence — and there is no picker to open here.
    const { container } = bar({ keyboard: 'unsupported' });

    expect(pill(container, 'keyboard').tagName).not.toBe('BUTTON');
  });
});

describe('the one OBS pill', () => {
  it('says OBS, and leaves the figures out entirely', () => {
    // The figures left the bar: who is listening is read in the OBS popover
    // (spec §16.4, §16.13), and the rate is not shown at all.
    const { container } = bar();

    expect(pill(container, 'obs').textContent!.trim()).toBe('OBS');
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

describe('one form for every pill (board Editor-StatusPills)', () => {
  it('says each state short, and what the click does on hover', () => {
    const cases: [
      Partial<{ keyboard: KeyboardStatus; obs: ObsStatus }>,
      string,
      string,
      string | null,
    ][] = [
      [{}, 'keyboard', 'Wooting 60HE+', 'Choose another keyboard'],
      [{ keyboard: 'disconnected' }, 'keyboard', 'No keyboard', 'Click to choose a keyboard'],
      [{}, 'obs', 'OBS', null],
      [{ obs: 'disconnected' }, 'obs', 'OBS disconnected', 'Click to reconnect'],
    ];
    for (const [overrides, name, text, hint] of cases) {
      const { container, unmount } = bar(overrides);
      expect(pill(container, name).textContent!.trim()).toBe(text);
      expect(pill(container, name).hasAttribute('title')).toBe(false);
      expect(tip(pill(container, name))).toBe(hint);
      unmount();
    }
  });

  it('shows the other capture pages as a pill of the same run', () => {
    const { container } = render(StatusBar, {
      props: { ...baseProps(), otherCapture: true },
    });
    const rival = pill(container, 'rival');

    expect(rival.textContent!.trim()).toBe('Other capture pages open');
    expect(rival.classList).toContain('pill');
    expect(rival.classList).toContain('down');
    // Nothing to click and nothing to add on hover: text, under the arrow.
    expect(rival.tagName).not.toBe('BUTTON');
    expect(rival.classList).not.toContain('act');
    expect(tip(rival)).toBeNull();
  });

  it('cuts only the keyboard name, and only when asked to', async () => {
    const { container, rerender } = render(StatusBar, { props: baseProps() });
    const keyboard = pill(container, 'keyboard');

    expect(keyboard.classList).not.toContain('squeeze');
    await rerender({ ...baseProps(), squeeze: true });
    expect(keyboard.classList).toContain('squeeze');
    // The name in its own box, which is what an ellipsis can cut; the dot apart.
    expect(keyboard.querySelector('.device')!.textContent).toBe('Wooting 60HE+');
    expect(keyboard.querySelector('.dot')).not.toBeNull();
    expect(pill(container, 'obs').classList).not.toContain('squeeze');
  });

  it('never lets a cut pill shrink below its dot and 40 px of name: no pill runs under the next', () => {
    const style = (/<style>([\s\S]*?)<\/style>/.exec(statusSource)?.[1] ?? '').replace(/\s+/g, ' ');
    const floor = /--pill-floor: ([^;]+);/.exec(style)?.[1];
    expect(floor).toBe('calc(8px + 7px + 40px)');
    for (const selector of ['.pill.squeeze', '.slot.squeeze']) {
      const at = style.indexOf(` ${selector} {`);
      const rule = at < 0 ? '' : style.slice(at, style.indexOf('}', at));
      expect(rule, selector).toMatch(/min-inline-size: var\(--pill-floor\)/);
    }
    // The tooltip's host around a cut pill keeps the same floor.
    expect(style).toMatch(
      /:global\(\[data-tooltip-host\]:has\(> \.pill\.squeeze\)\) \{[^}]*min-inline-size: var\(--pill-floor\)/,
    );
  });

  it('leaves the keyboard and OBS their dot alone at the last step, the name on hover', async () => {
    const { container, rerender } = render(StatusBar, {
      props: { ...baseProps(), otherCapture: true, squeeze: true, squeezeObs: true },
    });
    await rerender({
      ...baseProps(),
      otherCapture: true,
      squeeze: true,
      squeezeObs: true,
      dots: true,
    });

    for (const [name, label] of [
      ['keyboard', 'Wooting 60HE+'],
      ['obs', 'OBS'],
    ] as const) {
      const p = pill(container, name);
      expect(p.classList).toContain('dots');
      expect(p.getAttribute('aria-label')).toBe(label);
      expect(tip(p)).toContain(label);
    }
    // The alert keeps its words.
    expect(pill(container, 'rival').classList).not.toContain('dots');
    expect(pill(container, 'rival').textContent!.trim()).toBe('Other capture pages open');
  });

  it('cuts the OBS pill too, last of all, when asked to', async () => {
    const { container, rerender } = render(StatusBar, { props: { ...baseProps(), squeeze: true } });
    expect(pill(container, 'obs').classList).not.toContain('squeeze');

    await rerender({ ...baseProps(), squeeze: true, squeezeObs: true });
    const obs = pill(container, 'obs');
    expect(obs.classList).toContain('squeeze');
    expect(obs.querySelector('.device')!.textContent).toBe('OBS');
    expect(obs.querySelector('.dot')).not.toBeNull();
  });
});
