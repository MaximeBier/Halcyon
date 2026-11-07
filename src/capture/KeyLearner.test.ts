import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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

describe('KeyLearner - once armed, every key is a key to learn', () => {
  /** `learning` bound the way the page binds it. */
  function armable(onArm = vi.fn()) {
    let learning = false;
    const onCancel = vi.fn(() => (learning = false));
    const view = render(KeyLearner, {
      props: {
        get learning() {
          return learning;
        },
        set learning(value: boolean) {
          learning = value;
        },
        onCancel,
        onArm,
      },
    });
    return { ...view, onArm, onCancel, isLearning: () => learning };
  }

  it('lets go of the focus, so Enter or Space is learned rather than pressing Stop capture', async () => {
    const { container, isLearning, onCancel } = armable();
    const add = button(container);
    add.focus();

    await fireEvent.click(add);

    expect(isLearning()).toBe(true);
    // A focused button turns Enter and Space into a click: Stop capture, and
    // the key just learned taken back with it.
    expect(document.activeElement).not.toBe(add);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('hands the focus to the page once armed (the stage)', async () => {
    const { container, onArm } = armable();

    await fireEvent.click(button(container));

    expect(onArm).toHaveBeenCalledOnce();
  });

  it('still stops on its own click: Stop capture is the way out with the pointer', async () => {
    const { container, isLearning, onArm, onCancel } = armable();
    await fireEvent.click(button(container));

    await fireEvent.click(button(container));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(isLearning()).toBe(false);
    expect(onArm).toHaveBeenCalledOnce();
  });
});
