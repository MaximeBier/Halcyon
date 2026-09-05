import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import ObsPopover from './ObsPopover.svelte';
import type { ObsStatus } from '../transport/obs';

afterEach(cleanup);

function popover(
  overrides: {
    obs?: ObsStatus;
    overlays?: { inObs: number; inBrowser: number };
    size?: { width: number; height: number } | null;
    copies?: boolean;
  } = {},
) {
  const settings = { port: 4455, password: 'secret' };
  const handlers = {
    onReconnect: vi.fn(),
    onCopy: vi.fn(() => Promise.resolve(overrides.copies ?? true)),
    onClose: vi.fn(),
  };
  const props = {
    obs: overrides.obs ?? ('identified' as ObsStatus),
    overlays: overrides.overlays ?? { inObs: 1, inBrowser: 0 },
    url: 'http://localhost:5173/overlay.html?port=4455#password=secret',
    size: overrides.size === undefined ? { width: 216, height: 216 } : overrides.size,
    settings,
    ...handlers,
  };
  return { ...render(ObsPopover, { props }), ...handlers, settings };
}

const q = <T extends HTMLElement>(c: HTMLElement, selector: string) =>
  c.querySelector<T>(selector)!;

describe('what the popover says about the connection', () => {
  it('reports who is listening once connected', () => {
    const { container } = popover({ overlays: { inObs: 1, inBrowser: 0 } });

    expect(container.textContent).toContain('receiving frames');
  });

  it('names the tab as the thing that is not a source in OBS', () => {
    // The exact confusion the fold this replaced was built around: a tab
    // opened to check the overlay is an overlay too (spec §16.7).
    const { container } = popover({ overlays: { inObs: 0, inBrowser: 1 } });

    expect(container.textContent).toContain('no source in OBS yet');
  });

  it('gives the full sentence, with what to do, while OBS is down', () => {
    // The pill says "not answering"; this is where the WebSocket server and
    // the local network permission get named.
    const { container } = popover({ obs: 'unreachable' });

    expect(container.textContent).toMatch(/websocket server/i);
    expect(container.textContent).toMatch(/site settings/i);
  });
});

describe('the URL to paste', () => {
  it('shows it read-only, with the password inside', () => {
    const { container } = popover();

    const field = q<HTMLInputElement>(container, 'input[readonly]');
    expect(field.value).toContain('overlay.html');
    expect(field.value).toContain('password=secret');
  });

  it('copies through the caller and says so', async () => {
    const { container, onCopy } = popover();

    await fireEvent.click(q(container, '[data-copy]'));
    await Promise.resolve();

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(q(container, '[data-copy]').textContent).toContain('Copied');
  });

  it('admits a copy that did not happen', async () => {
    // The copy can silently fail (see `clipboard.ts`), and a button saying
    // "Copied" over an empty clipboard sends someone pasting nothing into OBS.
    const { container } = popover({ copies: false });

    await fireEvent.click(q(container, '[data-copy]'));
    await Promise.resolve();

    expect(q(container, '[data-copy]').textContent).toContain('Failed');
  });
});

describe('the size to give the source', () => {
  it('quotes the packed size', () => {
    const { container } = popover({ size: { width: 216, height: 144 } });

    expect(q(container, '[data-size]').textContent).toContain('216 × 144 px');
  });

  it('quotes nothing while there is no key to pack', () => {
    const { container } = popover({ size: null });

    expect(container.querySelector('[data-size]')).toBeNull();
  });
});

describe('the two credentials', () => {
  it('writes the port into the live settings and asks for a reconnect', async () => {
    const { container, settings, onReconnect } = popover();

    const port = q<HTMLInputElement>(container, 'input[type="number"]');
    port.value = '4456';
    await fireEvent.input(port);
    await fireEvent.change(port);

    expect(settings.port).toBe(4456);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('masks the password until asked, then shows it', async () => {
    // The password OBS generated is long forgotten by the time someone comes
    // back here, and a masked field cannot be checked against OBS's window.
    const { container } = popover();
    const secret = q<HTMLInputElement>(container, 'input[type="password"]');
    expect(secret.value).toBe('secret');

    await fireEvent.click(q(container, '[data-reveal]'));

    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(q<HTMLInputElement>(container, 'input[type="text"]:not([readonly])').value).toBe(
      'secret',
    );
  });

  it('says where the password goes', () => {
    // The clear-text storage is a judged trade-off (spec §10), and the
    // interface says so rather than hiding it.
    const { container } = popover();

    expect(container.textContent).toContain('Stored in this browser');
  });
});

describe('closing', () => {
  it('takes the focus on open, and asks to close on Escape', async () => {
    const { container, onClose } = popover();

    expect(document.activeElement).toBe(q(container, '[data-obs-popover]'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks to close on a pointer outside its own slot, and not on one inside', async () => {
    const { container, onClose } = popover();

    q(container, 'input[readonly]').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    );
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
