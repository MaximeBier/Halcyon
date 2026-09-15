import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import SceneLinks from './SceneLinks.svelte';
import type { ObsStatus } from '../transport/obs';
import type { SceneRow } from './scenes';

afterEach(cleanup);

const ROWS: SceneRow[] = [
  { uuid: 'u-soon', name: 'Starting soon', profile: null, live: false, missing: false },
  { uuid: 'u-game', name: 'Gameplay', profile: 'Apex ranked', live: true, missing: false },
  { uuid: 'u-chat', name: 'Just chatting', profile: 'Vholume', live: false, missing: true },
];

function links(overrides: { obs?: ObsStatus; rows?: SceneRow[] } = {}) {
  const handlers = { onOpen: vi.fn(), onLink: vi.fn(), onUnlink: vi.fn() };
  const props = {
    obs: overrides.obs ?? ('identified' as ObsStatus),
    rows: overrides.rows ?? ROWS,
    profiles: ['Default', 'Apex ranked', 'Racing'],
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

describe('the header button', () => {
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
    expect(trigger().title).toBe('Connect OBS first');
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
