// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { FONT_CATALOG, firstFamily, fontStack } from './fonts';
import { isStyleValue } from './validate';

describe('FONT_CATALOG', () => {
  it('starts with the default face', () => {
    expect(FONT_CATALOG[0]?.family).toBe('Archivo');
  });

  it('offers only names and weights a profile may hold', () => {
    for (const { family, weight } of FONT_CATALOG) {
      expect(isStyleValue('fontFamily', family)).toBe(true);
      expect(isStyleValue('fontWeight', weight)).toBe(true);
    }
  });
});

describe('fontStack', () => {
  it('gives Archivo the system fallbacks alone', () => {
    expect(fontStack('Archivo')).toBe("'Archivo', system-ui, sans-serif");
  });

  it('puts Archivo right behind any other family', () => {
    expect(fontStack('Chakra Petch')).toBe("'Chakra Petch', 'Archivo', system-ui, sans-serif");
  });

  it('reads back to the family it was built from', () => {
    expect(firstFamily(fontStack('Segoe UI'))).toBe('Segoe UI');
  });
});

describe('firstFamily', () => {
  it('keeps the first name of a stack, without its quotes', () => {
    expect(firstFamily("'Archivo', system-ui, sans-serif")).toBe('Archivo');
    expect(firstFamily('"Chakra Petch", serif')).toBe('Chakra Petch');
  });

  it('trims the spaces around the name, not inside it', () => {
    expect(firstFamily('  Segoe UI  ')).toBe('Segoe UI');
  });

  it('leaves a plain family name alone', () => {
    expect(firstFamily('Fredoka')).toBe('Fredoka');
  });
});
