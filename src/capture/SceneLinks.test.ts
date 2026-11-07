import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { openPicker } from '../test/picker';
import SceneLinks from './SceneLinks.svelte';
import type { ObsStatus } from '../transport/obs';
import type { SceneRow } from './scenes';

afterEach(cleanup);

const ROWS: SceneRow[] = [
  { uuid: 'u-soon', name: 'Starting soon', profile: null, live: false, missing: false },
  { uuid: 'u-game', name: 'Gameplay', profile: 'Apex ranked', live: true, missing: false },
  { uuid: 'u-chat', name: 'Just chatting', profile: 'Vholume', live: false, missing: true },
];

function links(overrides: { obs?: ObsStatus; rows?: SceneRow[]; compact?: boolean } = {}) {
  const handlers = { onOpen: vi.fn(), onLink: vi.fn(), onUnlink: vi.fn() };
  const props = {
    obs: overrides.obs ?? ('identified' as ObsStatus),
    rows: overrides.rows ?? ROWS,
    profiles: ['Default', 'Apex ranked', 'Racing'],
    compact: overrides.compact ?? false,
    ...handlers,
  };
  const rendered = render(SceneLinks, { props });
  const trigger = () =>
    rendered.container.querySelector<HTMLButtonElement>('[data-scenes-trigger]')!;
  const open = async () => {
    trigger().click();
    await tick();
  };
  return { ...rendered, ...handlers, props, trigger, open };
}

const tip = (el: HTMLElement) =>
  el.closest('[data-tooltip-host]')?.querySelector('[role="tooltip"]')?.textContent ?? null;

describe('the header button', () => {
  it('keeps only its icon at the header’s third step, its name on hover (board Editor-HeaderNarrow)', () => {
    const { trigger } = links({ compact: true });
    expect(trigger().textContent!.trim()).toBe('');
    expect(trigger().querySelector('svg')).not.toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('Link OBS scenes');
    expect(trigger().classList).toContain('compact');
    expect(tip(trigger())).toBe('Link OBS scenes');
  });

  it('keeps its tooltip out of the way of its own menu, like ⚙, ⋯ and +', async () => {
    const { trigger, open } = links({ compact: true });
    await open();
    const ownTip = trigger()
      .closest('[data-tooltip-host]')
      ?.querySelector(':scope > [role="tooltip"]');
    expect(ownTip ?? null).toBeNull();
  });

  it('keeps its accent outline as an icon while there is something to set up', () => {
    const unlinked = ROWS.map((r) => ({ ...r, profile: null }));
    const { trigger } = links({ rows: unlinked, compact: true });
    expect(trigger().dataset.state).toBe('pitch');
    expect(trigger().classList).not.toContain('he-btn-quiet');
  });

  it('says its name in full and needs no tooltip while it has room', () => {
    const { trigger } = links();
    expect(trigger().textContent!.trim()).toBe('Link OBS scenes');
    expect(tip(trigger())).toBeNull();
  });

  it('pitches while nothing is linked, goes quiet once something is', () => {
    const unlinked = ROWS.map((r) => ({ ...r, profile: null }));
    expect(links({ rows: unlinked }).trigger().dataset.state).toBe('pitch');
    cleanup();
    expect(links().trigger().dataset.state).toBe('quiet');
  });

  it('is inert without OBS, and says why', async () => {
    const { trigger, open, container, onOpen } = links({ obs: 'disconnected' });
    expect(trigger().dataset.state).toBe('inert');
    expect(trigger().disabled).toBe(true);
    // The page's tooltip, not a title (board Editor-Tooltip).
    expect(trigger().hasAttribute('title')).toBe(false);
    expect(tip(trigger())).toBe('Connect OBS to link scenes');
    await open();
    expect(container.querySelector('[data-scenes-popover]')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the popover, asks for a fresh list, and closes on Escape', async () => {
    const { container, open, onOpen } = links();
    await open();
    expect(container.querySelector('[data-scenes-popover]')).not.toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(container.querySelector('[data-scenes-popover]')).toBeNull();
  });

  it('keeps the table open when Escape closes a dropdown', async () => {
    const { container, open } = links();
    await open();
    const picker = openPicker();

    picker.escape();
    await tick();

    expect(container.querySelector('[data-scenes-popover]')).not.toBeNull();
    picker.remove();
  });

  it('closes the table under the cursor when OBS goes away', async () => {
    // The rows are a snapshot of an OBS that is gone: every select in them
    // would write a link against a list nobody can check any more.
    const { container, open, props, rerender, trigger } = links();
    await open();
    expect(container.querySelector('[data-scenes-popover]')).not.toBeNull();

    await rerender({ ...props, obs: 'disconnected' as ObsStatus });
    await tick();

    expect(container.querySelector('[data-scenes-popover]')).toBeNull();
    expect(trigger().dataset.state).toBe('inert');
  });
});

describe('the rows', () => {
  it('lists the scenes in order, marks the live one and the missing one', async () => {
    const { container, open } = links();
    await open();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-scene]')];
    expect(rows.map((r) => r.dataset.scene)).toEqual(['u-soon', 'u-game', 'u-chat']);
    expect(rows[1]!.dataset.live).toBe('true');
    expect(rows[1]!.textContent).toContain('live');
    expect(rows[2]!.dataset.missing).toBe('true');
    expect(rows[2]!.textContent).toContain('not in OBS');
  });

  it('offers every profile and a dash, and reports the pick', async () => {
    const { container, open, onLink } = links();
    await open();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-scene="u-soon"] select[data-profile]',
    )!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '—',
      'Default',
      'Apex ranked',
      'Racing',
    ]);
    expect(select.value).toBe('');

    await fireEvent.change(select, { target: { value: 'Racing' } });
    expect(onLink).toHaveBeenCalledWith('u-soon', 'Racing');
  });

  it('turns the dash back into an unlink', async () => {
    const { container, open, onLink } = links();
    await open();
    const select = container.querySelector<HTMLSelectElement>(
      '[data-scene="u-game"] select[data-profile]',
    )!;
    expect(select.value).toBe('Apex ranked');
    await fireEvent.change(select, { target: { value: '' } });
    expect(onLink).toHaveBeenCalledWith('u-game', null);
  });

  it('shows a missing scene read-only, with a cross that forgets it', async () => {
    const { container, open, onUnlink } = links();
    await open();
    const row = container.querySelector<HTMLElement>('[data-scene="u-chat"]')!;
    expect(row.querySelector('select')).toBeNull();
    expect(row.textContent).toContain('Vholume');
    row.querySelector<HTMLButtonElement>('[data-unlink]')!.click();
    expect(onUnlink).toHaveBeenCalledWith('u-chat');
  });

  it('says so when OBS has no scene at all', async () => {
    const { container, open } = links({ rows: [] });
    await open();
    expect(container.querySelector('[data-scenes-popover]')!.textContent).toContain(
      'No scene in OBS yet',
    );
  });
});

describe('the dropdowns', () => {
  it("open the page's own menu, a scene's at its narrower width", async () => {
    // The class is the contract with controls.css (spec §16.10).
    const { container, open } = links();
    await open();
    const selects = [...container.querySelectorAll<HTMLSelectElement>('select[data-profile]')];

    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select.classList.contains('he-select')).toBe(true);
      expect(select.classList.contains('he-select--scene')).toBe(true);
    }
  });

  it('says a scene has no profile while its value is empty', async () => {
    const { container, open } = links({ rows: [{ ...ROWS[0]!, profile: null }] });
    await open();

    expect(container.querySelector('select[data-profile]')!.classList.contains('unset')).toBe(true);
  });
});

describe('the trigger, once configured', () => {
  it('turns into the quiet header button', () => {
    expect(links().trigger().classList.contains('he-btn-quiet')).toBe(true);
  });

  it('keeps its accent outline while nothing is linked', () => {
    const unlinked = ROWS.map((row) => ({ ...row, profile: null }));
    expect(links({ rows: unlinked }).trigger().classList.contains('he-btn-quiet')).toBe(false);
  });
});
