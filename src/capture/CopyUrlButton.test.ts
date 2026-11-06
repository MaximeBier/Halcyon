import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import CopyUrlButton from './CopyUrlButton.svelte';

afterEach(cleanup);

const button = (c: Element) => c.querySelector<HTMLButtonElement>('button[data-copy-url]')!;
const tip = (c: Element) => c.querySelector('[role="tooltip"]')?.textContent;
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await tick();
};

describe('CopyUrlButton (board Main, bottom of the stage)', () => {
  it('is a bare 24 px icon button with a link, named by its tooltip', () => {
    const { container } = render(CopyUrlButton, { props: { onCopy: async () => true } });

    expect(button(container).classList).toContain('he-icon-btn');
    expect(button(container).classList).toContain('he-icon-btn--bare');
    expect(button(container).getAttribute('aria-label')).toBe('Copy overlay URL');
    expect(button(container).dataset.copied).toBe('idle');
    expect(tip(container)).toBe('Copy overlay URL');
    // Not the native one: the page's own tooltip says it.
    expect(button(container).hasAttribute('title')).toBe(false);
  });

  it('copies through the action it is given, the one Settings uses', async () => {
    const onCopy = vi.fn(async () => true);
    const { container } = render(CopyUrlButton, { props: { onCopy } });

    button(container).click();
    await settle();

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('says it is done for two seconds, then goes back to the link', async () => {
    const { container } = render(CopyUrlButton, { props: { onCopy: async () => true } });

    button(container).click();
    await settle();
    expect(button(container).dataset.copied).toBe('done');
    expect(tip(container)).toBe('Overlay URL copied');
    expect(container.querySelector('[data-said]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Overlay URL copied');

    // The two seconds are a CSS animation (spec §2: no timer on this page).
    container.querySelector('[data-said]')!.dispatchEvent(new Event('animationend'));
    await settle();
    expect(button(container).dataset.copied).toBe('idle');
    expect(tip(container)).toBe('Copy overlay URL');
  });

  it('never claims a copy that did not happen', async () => {
    const { container } = render(CopyUrlButton, { props: { onCopy: async () => false } });

    button(container).click();
    await settle();

    expect(button(container).dataset.copied).toBe('failed');
    expect(tip(container)).toBe('Copy failed');
  });
});
