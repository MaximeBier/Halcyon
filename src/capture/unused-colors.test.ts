import { describe, it, expect } from 'vitest';
import { GAMEPAD_FILL, NO_BACKGROUND, unusedColors } from './unused-colors';
import { defaultConfig, type KeyConfig } from '../config/schema';

const key = (id: number, mode: 'key' | 'axis' = 'key', style?: KeyConfig['style']): KeyConfig => ({
  id,
  usage: 0x04 + id,
  mode,
  label: 'A',
  x: id,
  y: 0,
  w: 1,
  h: 1,
  ...(style ? { style } : {}),
});

const global = (restVisibility: 'filled' | 'outline' | 'hidden' = 'filled') => ({
  ...defaultConfig().style,
  restVisibility,
});

describe('colours that paint nothing (board Editor-Tooltip)', () => {
  describe('Background, under Outline only', () => {
    it('is out of use in the panel when the global rest is an outline and no key differs', () => {
      expect(unusedColors(global('outline'), [key(1), key(2)], 'profile')).toEqual({
        restColor: NO_BACKGROUND,
      });
    });

    it('stays in use in the panel while one key rests with a face', () => {
      const keys = [key(1), key(2, 'key', { restVisibility: 'filled' })];
      expect(unusedColors(global('outline'), keys, 'profile')).toEqual({});
    });

    it('stays in use in the panel under a global rest with a face, whatever the keys', () => {
      // The global Background is what every key added later wears.
      const keys = [key(1, 'key', { restVisibility: 'outline' })];
      expect(unusedColors(global('filled'), keys, 'profile')).toEqual({});
    });

    it('is out of use in the popover when every selected key rests as an outline', () => {
      const keys = [key(1, 'key', { restVisibility: 'outline' }), key(2)];
      expect(unusedColors(global('filled'), [keys[0]!], 'selection')).toEqual({
        restColor: NO_BACKGROUND,
      });
      expect(unusedColors(global('filled'), keys, 'selection')).toEqual({});
    });

    it('is in use under Hidden until pressed: a key appears wearing it', () => {
      expect(unusedColors(global('hidden'), [key(1)], 'profile')).toEqual({});
    });
  });

  describe('Press depth, on Gamepad keys', () => {
    it('is out of use in the popover when every selected key is a gamepad input', () => {
      const keys = [key(1, 'axis'), key(2, 'axis')];
      expect(unusedColors(global(), keys, 'selection')).toEqual({ fillColor: GAMEPAD_FILL });
    });

    it('stays in use in the panel, even on a profile of gamepad inputs only', () => {
      // The panel sets the keys still to come too, and the next key added is
      // a keyboard key: it would fill with a Press depth no one could set.
      expect(unusedColors(global(), [key(1, 'axis'), key(2, 'axis')], 'profile')).toEqual({});
    });

    it('stays in use while one of them is a keyboard key', () => {
      expect(unusedColors(global(), [key(1, 'axis'), key(2)], 'selection')).toEqual({});
    });

    it('stays in use on a profile with no keys: the next key added is a keyboard key', () => {
      expect(unusedColors(global(), [], 'profile')).toEqual({});
    });
  });

  it('puts both out of use at once when both hold', () => {
    const keys = [key(1, 'axis'), key(2, 'axis')];
    expect(unusedColors(global('outline'), keys, 'selection')).toEqual({
      restColor: NO_BACKGROUND,
      fillColor: GAMEPAD_FILL,
    });
  });

  it('says it in the words of the board', () => {
    expect(NO_BACKGROUND).toBe('No background while At rest is “Outline only”.');
    expect(GAMEPAD_FILL).toBe('Gamepad keys fill with Triggered.');
  });
});
