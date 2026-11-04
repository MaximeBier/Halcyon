import type { LocalFace } from './installed-fonts';

/**
 * Where the page stands with Chrome on reading the fonts installed here.
 * `unsupported` is a browser without the API at all, which no click can fix.
 */
export type FontAccess = 'unsupported' | 'prompt' | 'granted' | 'denied';

/** The one door to Local Font Access, so the panel can be handed another. */
export interface LocalFonts {
  access(): Promise<FontAccess>;
  /**
   * Called straight from a click, never after an await: Chrome shows its
   * permission prompt to a user gesture and to nothing else.
   */
  read(): Promise<readonly LocalFace[] | 'denied'>;
}

interface FontData {
  family: string;
  style: string;
}

type WithLocalFonts = Window & { queryLocalFonts?: () => Promise<FontData[]> };

export const browserLocalFonts: LocalFonts = {
  async access() {
    if (typeof (window as WithLocalFonts).queryLocalFonts !== 'function') return 'unsupported';
    try {
      const status = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
      return status.state;
    } catch {
      // A browser that has the API but not the permission name: the read
      // itself will ask, which is all "prompt" means.
      return 'prompt';
    }
  },

  async read() {
    try {
      const faces = await (window as WithLocalFonts).queryLocalFonts!();
      // Blocked in the site's settings, Chrome throws nothing: it hands back
      // an empty list. No machine has no fonts at all, so an empty answer
      // without the permission is a refusal, and is told as one.
      if (faces.length === 0 && (await this.access()) !== 'granted') return 'denied';
      return faces.map(({ family, style }) => ({ family, style }));
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      ) {
        return 'denied';
      }
      throw error;
    }
  },
};
