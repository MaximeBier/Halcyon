import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import KeyboardView from './KeyboardView.svelte';
import { OVERLAY_TOKENS } from '../styles/tokens';
import { DEFAULT_STYLE, type ResolvedConfig } from '../config/schema';

afterEach(cleanup);

/**
 * The markup, with the per-instance clip ids normalised away.
 *
 * Two views on one page must not share a clip id, so the id is unique per
 * component and **deliberately** not the same twice. What has to be identical
 * for the same input is the *drawing* — geometry, colour, order — and the
 * identity of a definition is not part of it.
 */
const drawing = (html: string) => html.replace(/(id="|url\(#)[^"')]+/g, '$1clip');

const config: ResolvedConfig = {
  version: 1,
  unit: 100,
  gap: 10,
  restVisibility: 'filled',
  borderColor: DEFAULT_STYLE.borderColor,
  borderWidth: DEFAULT_STYLE.borderWidth,
  keys: [
    {
      id: 174,
      usage: 0x50,
      mode: 'key',
      label: 'Q',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      style: {
        restColor: '#111111',
        activeColor: '#00ff00',
        fillColor: '#ffffff',
        fillDirection: 'up',
        opacity: 1,
        radius: 4,
        fontFamily: DEFAULT_STYLE.fontFamily,
        fontWeight: DEFAULT_STYLE.fontWeight,
      },
    },
  ],
};

const axisConfig: ResolvedConfig = {
  ...config,
  keys: [{ ...config.keys[0]!, mode: 'axis' }],
};

describe('KeyboardView', () => {
  it('draws a released key with the rest color', () => {
    const { container } = render(KeyboardView, { props: { config, frame: [] } });

    const rects = container.querySelectorAll('rect');
    expect(rects[0]?.getAttribute('fill')).toBe('#111111');
  });

  it('draws a fully pressed active key entirely in the active color', () => {
    // Background and fill both, because the fill covers the whole key: what
    // the viewer sees is the active colour and nothing else.
    const { container, getByText } = render(KeyboardView, {
      props: { config, frame: [[174, 1023, 1] as const] },
    });

    const rects = container.querySelectorAll('rect');
    expect(rects[0]?.getAttribute('fill')).toBe('#ffffff'); // fill colour behind
    expect(rects[1]?.getAttribute('fill')).toBe('#00ff00'); // active colour on top
    expect(rects[1]?.getAttribute('height')).toBe('90');
    expect(getByText('Q')).toBeTruthy();
  });

  it('never displays the raw value', () => {
    const { queryByText } = render(KeyboardView, {
      props: { config, frame: [[174, 1023, 1] as const] },
    });

    expect(queryByText('1023')).toBeNull();
  });

  it('keeps one label colour and outlines it, whatever sits behind', () => {
    const shallow = render(KeyboardView, { props: { config, frame: [] } });
    const shallowLabel = shallow.container.querySelector('text')!;
    expect(shallowLabel.getAttribute('fill')).toBe(OVERLAY_TOKENS.keyLabel);
    cleanup();

    const deep = render(KeyboardView, { props: { config, frame: [[174, 900, 1] as const] } });
    const deepLabel = deep.container.querySelector('text')!;

    expect(deepLabel.getAttribute('fill')).toBe(OVERLAY_TOKENS.keyLabel);
    expect(deepLabel.getAttribute('stroke')).toBe(OVERLAY_TOKENS.keyLabelOutline);
    expect(deepLabel.getAttribute('paint-order')).toBe('stroke fill');
  });
});

describe('KeyboardView - what OBS sees and what the editor sees', () => {
  it('displays no editor decoration by default: this is what OBS sees', () => {
    const { queryByText } = render(KeyboardView, {
      props: { config: axisConfig, frame: [] },
    });

    expect(queryByText('AXIS')).toBeNull();
  });

  it('displays the AXIS label when the editor asks for it', () => {
    const { getByText } = render(KeyboardView, {
      props: { config: axisConfig, frame: [], decorations: true },
    });

    expect(getByText('AXIS')).toBeTruthy();
  });

  it('marks an axis key with the label alone, and never with a dashed border', () => {
    // The dashes went on 2026-08-23: the tag says it, and a second mark for the
    // same thing is a second mark to keep true. It also stopped meaning what it
    // looked like the day the border became a setting — a user-set 4 px outline
    // rendered as dashes says "axis" in a shape nobody chose.
    const { container } = render(KeyboardView, {
      props: { config: axisConfig, frame: [], decorations: true },
    });

    expect(container.querySelector('[stroke-dasharray]')).toBeNull();
  });

  it('produces a deterministic SVG for the same configuration-state pair', () => {
    const first = render(KeyboardView, { props: { config, frame: [[174, 400, 0] as const] } });
    const html = first.container.innerHTML;
    cleanup();
    const second = render(KeyboardView, { props: { config, frame: [[174, 400, 0] as const] } });

    expect(drawing(second.container.innerHTML)).toBe(drawing(html));
  });

  it('adds decorations without touching anything the broadcast shows', () => {
    // The whole point of the shared component (spec 5.2): were the editor and
    // the broadcast ever to differ on fill, colour or geometry, every style
    // adjustment would be a guess. Comparing the default against an explicit
    // `decorations: false` proved nothing — both take the same branch. What
    // has to hold is that turning it on adds the AXIS label and changes
    // nothing else.
    const frame = [[174, 700, 1] as const];

    const plain = render(KeyboardView, { props: { config: axisConfig, frame } });
    const broadcastHtml = plain.container.innerHTML;
    cleanup();

    const decorated = render(KeyboardView, {
      props: { config: axisConfig, frame, decorations: true },
    });
    const stripped = decorated.container.innerHTML.replace(/<text[^>]*>AXIS<[/]text>/, '').trim();

    expect(drawing(stripped)).toBe(drawing(broadcastHtml));
  });
});

describe('KeyboardView - the fill stays inside the key', () => {
  /** A tenth of the travel, filling left to right: a narrow bar on the edge. */
  const sliver: ResolvedConfig = {
    ...config,
    keys: [{ ...config.keys[0]!, style: { ...config.keys[0]!.style, fillDirection: 'right' } }],
  };

  it('rounds the fill by the key’s own radius, never by one of its own', () => {
    // The requirement, stated as an equality rather than as a number: whatever
    // radius the key is drawn with, the fill is bounded by *that* one. A value
    // nothing else uses, so a hard-coded default could not pass by luck.
    const round: ResolvedConfig = {
      ...config,
      keys: [{ ...config.keys[0]!, style: { ...config.keys[0]!.style, radius: 17 } }],
    };
    const { container } = render(KeyboardView, { props: { config: round, frame: [[174, 60, 0]] } });
    const rects = container.querySelectorAll('rect');
    const fill = rects[1]!;
    const id = fill.getAttribute('clip-path')!.match(/^url\(#(.+)\)$/)![1];
    const clip = container.querySelector(`clipPath#${id} rect`)!;

    // The key's own radius, the clip's radius, and the box they share.
    expect(rects[0]!.getAttribute('rx')).toBe('17');
    expect(clip.getAttribute('rx')).toBe(rects[0]!.getAttribute('rx'));
    expect(clip.getAttribute('x')).toBe(rects[0]!.getAttribute('x'));
    expect(clip.getAttribute('y')).toBe(rects[0]!.getAttribute('y'));
    expect(clip.getAttribute('width')).toBe(rects[0]!.getAttribute('width'));
    expect(clip.getAttribute('height')).toBe(rects[0]!.getAttribute('height'));
  });

  it('clips the fill to the rounded box of the key it belongs to', () => {
    // Found on screen: a barely-started fill escaped through the corners. SVG
    // clamps `rx` to half the width, so a 6 px bar was rounded by 3 where the
    // key was rounded by 4 — its corners stood outside the key's. No radius on
    // the fill can fix that, because the fill is not the shape being rounded.
    const { container } = render(KeyboardView, {
      props: { config: sliver, frame: [[174, 60, 0]] },
    });
    const fill = container.querySelectorAll('rect')[1]!;
    const id = fill.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];

    expect(id).toBeTruthy();
    const clip = container.querySelector(`clipPath#${id} rect`)!;
    expect(clip.getAttribute('rx')).toBe('4');
    expect(clip.getAttribute('width')).toBe('90');
    expect(clip.getAttribute('height')).toBe('90');
  });

  it('gives the fill no radius of its own', () => {
    // The clip does the corners, and only where the key actually has them: a
    // half-filled key must be square where the fill stops in mid-key, which a
    // radius on the fill drew as a notch.
    const { container } = render(KeyboardView, { props: { config, frame: [[174, 512, 0]] } });

    expect(container.querySelectorAll('rect')[1]!.getAttribute('rx')).toBeNull();
  });

  it('never shares a clip between two views on the same page', () => {
    // The capture page is meant to show the editor and a packed preview side by
    // side. A fixed id would make the second view's fills clip against the
    // first view's key — which is only ever right by accident.
    const first = render(KeyboardView, { props: { config, frame: [] } });
    const second = render(KeyboardView, { props: { config, frame: [] } });
    const idOf = (view: typeof first) =>
      view.container.querySelector('clipPath')!.getAttribute('id');

    expect(idOf(first)).not.toBe(idOf(second));
  });
});

describe('KeyboardView - the border it was given', () => {
  it('draws the stroke at the width and inset the scene computed', () => {
    // Without the attribute the stroke silently falls back to one pixel, which
    // looks like the setting doing nothing — and the inset would then be wrong
    // in the other direction.
    const thick: ResolvedConfig = { ...config, borderWidth: 4, borderColor: '#ff00aa' };
    const { container } = render(KeyboardView, { props: { config: thick, frame: [] } });
    const border = container.querySelectorAll('rect')[2]!;

    expect(border.getAttribute('stroke-width')).toBe('4');
    expect(border.getAttribute('stroke')).toBe('#ff00aa');
    expect(border.getAttribute('x')).toBe('7'); // the key box starts at 5, inset by half of 4
  });
});

describe('KeyboardView - the keys that are being pressed, and no others', () => {
  // The mode itself is the scene's business; what belongs here is that the
  // component hands the option through, and that one opacity really does take
  // the whole key off the screen — border and label with it.
  const hidden: ResolvedConfig = { ...config, restVisibility: 'hidden' };

  it('draws a resting key at no opacity at all', () => {
    const { container } = render(KeyboardView, { props: { config: hidden, frame: [] } });

    expect(container.querySelector('g')?.getAttribute('opacity')).toBe('0');
  });

  it('gives the key back its opacity as soon as it moves', () => {
    const { container } = render(KeyboardView, {
      props: { config: hidden, frame: [[174, 40, 0]] },
    });

    expect(container.querySelector('g')?.getAttribute('opacity')).toBe('1');
  });

  it('reveals every key when asked, which is how the editor stays usable', () => {
    const { container } = render(KeyboardView, {
      props: { config: hidden, frame: [], reveal: true },
    });

    expect(container.querySelector('g')?.getAttribute('opacity')).toBe('1');
  });
});
