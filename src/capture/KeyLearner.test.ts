import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import KeyLearner from './KeyLearner.svelte';

afterEach(cleanup);

const button = (container: HTMLElement) => container.querySelector('button')!;

describe('KeyLearner', () => {
  it('says what it does and nothing after it', () => {
    // No shortcut and no aside behind a "·" on a button (spec §16.12): the
    // capture says how it stops in the banner on the stage.
    const { container } = render(KeyLearner, { props: { learning: false, onCancel: vi.fn() } });

    expect(button(container).textContent!.trim()).toBe('Add key');
  });

  it('turns into the way out while it listens', () => {
    const { container } = render(KeyLearner, { props: { learning: true, onCancel: vi.fn() } });

    expect(button(container).textContent!.trim()).toBe('Stop capture');
  });
});

describe('KeyLearner - its level', () => {
  it("is the page's one primary button", () => {
    const { container } = render(KeyLearner, { props: { learning: false, onCancel: vi.fn() } });
    expect(button(container).classList.contains('he-btn-primary')).toBe(true);
  });
});

describe('KeyLearner - without a keyboard', () => {
  it('says why it is off, in the words of the board (Editor-Tooltip)', () => {
    const { container } = render(KeyLearner, {
      props: { learning: false, disabled: true, onCancel: vi.fn() },
    });

    expect(button(container).disabled).toBe(true);
    expect(container.querySelector('[role="tooltip"]')!.textContent).toBe(
      'Connect a keyboard to add keys',
    );
    // The tooltip, not the browser's: one would show over the other.
    expect(button(container).hasAttribute('title')).toBe(false);
  });

  it('has nothing to explain once a keyboard is there', () => {
    const { container } = render(KeyLearner, { props: { learning: false, onCancel: vi.fn() } });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });
});
