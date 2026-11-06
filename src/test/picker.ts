/**
 * A `<select>` whose picker is open, as far as the page's Escape handlers can
 * tell. jsdom renders no picker and throws on `:open`, so the state is played
 * by `matches`; the keystroke comes from the option, where Chrome puts the
 * focus while the picker is up.
 */
export function openPicker(): { select: HTMLSelectElement; escape(): void; remove(): void } {
  const select = document.createElement('select');
  const option = document.createElement('option');
  select.append(option);
  document.body.append(select);
  const original = select.matches.bind(select);
  select.matches = ((selector: string) =>
    selector === ':open' || original(selector)) as HTMLSelectElement['matches'];
  return {
    select,
    escape: () =>
      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    remove: () => select.remove(),
  };
}
