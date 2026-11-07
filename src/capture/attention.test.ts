// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { needsAttention } from './attention';
import type { MissingFont } from '../protocol/messages';

const font = (family: string, keys: number, total: number): MissingFont =>
  ({ family, keys, total }) as MissingFont;

describe('what Diagnostics asks someone to look at', () => {
  it('asks for nothing when nothing is wrong', () => {
    expect(needsAttention('auto', [])).toEqual([]);
  });

  it('names a layout forced by hand, with the way back to auto', () => {
    expect(needsAttention('azerty', [])).toEqual([
      {
        id: 'layout',
        text: 'Keyboard layout forced to AZERTY — auto-detection is off.',
        action: 'use-auto',
      },
    ]);
  });

  it('names each font the PC running OBS lacks, and how many keys fall back', () => {
    const items = needsAttention('auto', [
      font('Bahnschrift', 6, 6),
      font('Impact', 1, 6),
      font('Calibri', 2, 6),
    ]);

    expect(items.map((item) => item.text)).toEqual([
      'Bahnschrift is not installed on the PC running OBS. All keys are drawn in Archivo.',
      'Impact is not installed on the PC running OBS. 1 key is drawn in Archivo.',
      'Calibri is not installed on the PC running OBS. 2 keys are drawn in Archivo.',
    ]);
    expect(items.every((item) => item.action === 'change-font')).toBe(true);
  });

  it('puts the fonts first, the layout after, as the board does', () => {
    const items = needsAttention('qwertz', [font('Bahnschrift', 6, 6)]);

    expect(items.map((item) => item.action)).toEqual(['change-font', 'use-auto']);
    expect(items[1]!.text).toContain('QWERTZ');
  });
});
