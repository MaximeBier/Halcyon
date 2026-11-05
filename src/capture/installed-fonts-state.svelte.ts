import { getContext, setContext } from 'svelte';
import { families, type InstalledFamily } from './installed-fonts';
import { browserLocalFonts, type FontAccess, type LocalFonts } from './local-fonts';

/**
 * What the page knows about the fonts installed here, held once for every
 * place that offers them.
 *
 * The global panel and the key popover both list these fonts. Each holding
 * its own copy, the permission granted from one would leave the other asking
 * again, and "not installed here" could be said in one place and not the
 * other about the same family.
 */
export class InstalledFonts {
  /** `null` until somebody first asks: nothing is asked of Chrome before. */
  access = $state<FontAccess | null>(null);
  /** The installed families, once read — and `null` for as long as they are not. */
  list = $state<InstalledFamily[] | null>(null);

  readonly #source: LocalFonts;
  #asked = false;

  constructor(source: LocalFonts) {
    this.#source = source;
  }

  /**
   * Asks where the permission stands, once, and reads the list straight away
   * if it is already granted — reading needs no gesture then, and it is what
   * lets a row say "not installed here" before anyone clicks it.
   */
  probe(): void {
    if (this.#asked) return;
    this.#asked = true;
    void this.#source.access().then(async (state) => {
      this.access = state;
      if (state !== 'granted') return;
      try {
        const faces = await this.#source.read();
        if (faces !== 'denied') this.list = families(faces);
      } catch {
        // Unread is a state every caller already handles: the menu reads again.
      }
    });
  }

  /**
   * The list, read from a click — `null` when the read failed for a reason
   * that is not a refusal.
   *
   * `read()` is called in the same breath as the click: Chrome grants its
   * permission prompt to a gesture, and an await before it would spend it.
   * Read again on every call until a list comes back, so that someone who
   * re-allowed fonts in the site's settings only has to click again.
   */
  read(): Promise<InstalledFamily[] | 'denied' | null> {
    if (this.list !== null) return Promise.resolve(this.list);
    return this.#source.read().then(
      (faces) => {
        if (faces === 'denied') {
          this.access = 'denied';
          return 'denied' as const;
        }
        this.access = 'granted';
        this.list = families(faces);
        return this.list;
      },
      () => null,
    );
  }
}

const KEY = Symbol('installed-fonts');

/** Called by the page that holds both the panel and the popover. */
export function provideInstalledFonts(source: LocalFonts = browserLocalFonts): InstalledFonts {
  return setContext(KEY, new InstalledFonts(source));
}

/**
 * The page's shared instance — or one of its own when the caller hands it a
 * source, which is how a test speaks for Chrome, or when nothing provided one.
 */
export function useInstalledFonts(source?: LocalFonts): InstalledFonts {
  if (source) return new InstalledFonts(source);
  return getContext<InstalledFonts | undefined>(KEY) ?? new InstalledFonts(browserLocalFonts);
}
