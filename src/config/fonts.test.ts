// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { firstFamily } from './fonts';

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
