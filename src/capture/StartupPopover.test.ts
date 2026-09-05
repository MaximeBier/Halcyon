import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import StartupPopover from './StartupPopover.svelte';
import type { InstallWatch } from './startup';

afterEach(cleanup);

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const EDGE_UA = `${CHROME_UA} Edg/139.0.0.0`;

/** Rendered shut — every test that reads a step opens the guide first. */
function guide(
  props: { agent?: string; standalone?: boolean; install?: Partial<InstallWatch> } = {},
) {
  const onInstall = vi.fn();
  const rendered = render(StartupPopover, {
    props: {
      agent: props.agent ?? CHROME_UA,
      standalone: props.standalone ?? false,
      install: { prompt: null, installed: false, ...props.install },
      onInstall,
    },
  });
  const open = async () => {
    rendered.container.querySelector<HTMLButtonElement>('[data-startup-trigger]')!.click();
    await tick();
  };
  return { ...rendered, open, onInstall };
}

describe('StartupPopover - the guide itself', () => {
  it('opens on its trigger and closes on Escape', async () => {
    const { container, open } = guide();
    expect(container.querySelector('[data-startup-guide]')).toBeNull();

    await open();
    expect(container.querySelector('[data-startup-guide]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(container.querySelector('[data-startup-guide]')).toBeNull();
  });

  it('walks the three steps in the order they are done', async () => {
    const { container, open } = guide();
    await open();

    const steps = [...container.querySelectorAll('[data-step]')].map((s) =>
      s.getAttribute('data-step'),
    );

    expect(steps).toEqual(['install', 'autostart', 'background']);
  });
});

describe('StartupPopover - the install step', () => {
  it('points at the address bar when no prompt ever came', async () => {
    const { container, open } = guide();
    await open();

    expect(container.querySelector('[data-install]')).toBeNull();
    expect(container.querySelector('[data-step="install"]')?.textContent).toContain('install icon');
  });

  it('turns a held prompt into the install button, and spends it through the page', async () => {
    // The page holds the prompt (`watchInstall`), not this popover: Chrome
    // fires it once, early, and this popover is not mounted while the setup
    // wizard has the page. The click hands the spending back to the page.
    const { container, open, onInstall } = guide({
      install: { prompt: { prompt: () => Promise.resolve() } },
    });
    await open();

    container.querySelector<HTMLButtonElement>('[data-install]')!.click();

    expect(onInstall).toHaveBeenCalledOnce();
  });

  it('drops the button once the page has spent the prompt', async () => {
    const { container, open, rerender } = guide({
      install: { prompt: { prompt: () => Promise.resolve() } },
    });
    await open();
    expect(container.querySelector('[data-install]')).not.toBeNull();

    await rerender({ install: { prompt: null, installed: false } });
    await tick();

    expect(container.querySelector('[data-install]')).toBeNull();
  });

  it('reports the step done from inside the app window', async () => {
    const { container, open } = guide({ standalone: true });
    await open();

    expect(container.querySelector('[data-install]')).toBeNull();
    expect(container.querySelector('[data-step="install"]')?.textContent).toContain(
      'You are in the installed app.',
    );
  });

  it('sees an install announced from the old tab', async () => {
    const { container, open } = guide({ install: { installed: true } });
    await open();

    expect(container.querySelector('[data-step="install"]')?.textContent).toContain(
      'Halcyon has its own window now.',
    );
  });
});

describe('StartupPopover - trigger style inside the installed app', () => {
  it('keeps the accent pill when the page is not standalone', () => {
    const { container } = guide({ standalone: false });
    const trigger = container.querySelector('[data-startup-trigger]')!;

    expect(trigger.classList.contains('demoted')).toBe(false);
  });

  it('demotes the trigger to quiet text once the page runs standalone', () => {
    const { container } = guide({ standalone: true });
    const trigger = container.querySelector('[data-startup-trigger]')!;

    expect(trigger.classList.contains('demoted')).toBe(true);
  });
});

describe('StartupPopover - focus', () => {
  it('moves focus to the dialog when it opens', async () => {
    const { container, open } = guide();
    await open();

    expect(document.activeElement).toBe(container.querySelector('[data-startup-guide]'));
  });

  it('returns focus to the trigger on Escape', async () => {
    const { container, open } = guide();
    await open();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();

    expect(document.activeElement).toBe(container.querySelector('[data-startup-trigger]'));
  });
});

describe('StartupPopover - the sign-in step', () => {
  it('shows Chrome users the chrome://apps address', async () => {
    const { container, open } = guide();
    await open();

    expect(container.querySelector('[data-address]')?.textContent).toBe('chrome://apps');
    expect(container.querySelector('[data-step="autostart"]')?.textContent).toContain(
      'Start app when you sign in',
    );
  });

  it('shows Edge users their own address and toggle', async () => {
    const { container, open } = guide({ agent: EDGE_UA });
    await open();

    expect(container.querySelector('[data-address]')?.textContent).toBe('edge://apps');
    expect(container.querySelector('[data-step="autostart"]')?.textContent).toContain(
      'Auto-start on device login',
    );
  });

  it('copies the address, since no page may link to it', async () => {
    const written: string[] = [];
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
    });

    try {
      const { container, open } = guide();
      await open();

      const copy = container.querySelector<HTMLButtonElement>('[data-copy]')!;
      copy.click();
      await tick();
      await tick();

      expect(written).toEqual(['chrome://apps']);
      expect(copy.textContent).toBe('Copied');
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, 'clipboard', original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
