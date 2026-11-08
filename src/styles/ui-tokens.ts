/**
 * Settings interface only. Nothing from here goes out on the broadcast — and
 * nothing from here reaches the overlay's bundle either, which is why it lives
 * in its own file: the overlay imports the configuration schema, the schema
 * imports the broadcast tokens, and a single module would have dragged this
 * palette into the chunk OBS keeps loaded (spec §5.1).
 */
export const UI_TOKENS = {
  bg: '#0E1015',
  /**
   * The work surface, a step below the page so the stage stands apart from the
   * panel beside it (spec §16.13). Darker than any field, which is why fields
   * have their own `well`.
   */
  stage: '#08090C',
  /** The ground of every field: number, hex, URL, name, search. */
  well: '#0B0D11',
  surface: '#151823',
  /**
   * A step below `surface`, for a box that groups controls without lifting
   * them: the style groups in the sidebar and the wizard's rail (boards 3a, 4a).
   */
  surfaceLow: '#10131B',
  popover: '#141722',
  border: '#1B1E27',
  borderControl: '#232838',
  borderPopover: '#262B3A',
  /** Also the disabled dot. The mockup gives one value both jobs. */
  borderHover: '#3A4054',
  /**
   * Toast borders, one per tone (spec §16.6). Deeper than the dot they sit
   * beside — a toast reads as a message, not as an alert box, and a border in
   * the dot's own colour is the difference.
   */
  borderOk: '#2E5D42',
  /** The wizard rail's thread under a step that is behind us: a dimmed green (board Wizard 4a). */
  wireOk: '#2E4A3B',
  borderWarn: '#4A3820',
  borderDanger: '#3A2226',
  accent: '#7C9EFF',
  accentHover: '#a5bcff',
  /**
   * Something to look at, and only that (spec §16.13): Resume setup, the gear's
   * dot, a forced layout, a font missing here or on the PC running OBS. A key
   * with a style of its own is not a warning — it wears the accent.
   */
  warn: '#D9A05B',
  danger: '#E06C5B',
  ok: '#4CAF7D',
  text: '#DDE1E9',
  textMuted: '#8B90A0',
  /**
   * Decoration only — separators, dotted outlines, the "—" of an unlinked
   * scene. Nothing meant to be read goes under `textMuted` (spec §16.13).
   */
  textFaint: '#5A5F70',
  /**
   * The type scale, one step per role, **taken from the lot** — not guessed.
   *
   * The mockup is drawn on an 1180 px board and its figures are absolute: 9.5
   * to 12.5 px. Applied literally to a real window they read as too small,
   * because the board was never the size of anybody's screen. These four steps
   * keep the mockup's *ratios* and lift the whole thing one notch; changing
   * them here changes the whole interface at once, which is the point of
   * having them rather than forty literals.
   */
  sizeXs: '14px',
  sizeSm: '15px',
  sizeMd: '16px',
  sizeLg: '18px',
  /** The wizard's own step title (board 4a). */
  sizeTitle: '24px',
  font: "400 16px 'Archivo', system-ui, sans-serif",
  fontMono: "400 15px 'IBM Plex Mono', ui-monospace, monospace",
  /**
   * Three radii (spec §16.13): 4 for anything one presses or types in —
   * buttons, fields, segments, list rows; 6 for what floats or groups —
   * popovers, menus, the panel's groups, the selection bar; 10 for the setup
   * card alone. The keys keep the radius of their own style.
   */
  radius: '4px',
  radiusPanel: '6px',
  radiusCard: '10px',
  headerHeight: '54px',
  /**
   * The header's right block, measured box to box — frame to frame, hover
   * face to hover face — whatever face each button wears (spec §16.9). Wide
   * while the buttons still say their names (board Main), closer once they
   * are 28 px icons (board Editor-HeaderNarrow), where the wide gap left the
   * row looking scattered.
   */
  headerToolsGap: '14px',
  headerToolsGapIcons: '8px',
  /** Undo and Redo, one pair: a step closer than the rest of the row (boards Main, Editor-HeaderNarrow). */
  headerPairGap: '6px',
  /** The profile tab row under the header (board 3a). */
  tabRowHeight: '50px',
  panelWidth: '380px',
  /**
   * The stage's floor both ways (spec §16.9): under 560 + 380 px of window the
   * panel drops below it, and it never gets shorter than this — the key
   * popover unfolded needs about that much to fit.
   */
  stageMinSize: '560px',
  /**
   * The window width from which stage and panel sit side by side: the stage's
   * floor plus the panel. Written out in App.svelte's container queries, which
   * take no var(); a test holds them to this.
   */
  splitBreakpoint: '940px',
  /** Side by side, the panel's Keys list never gets shorter: Global style gives way first. */
  panelListMinSize: '200px',
  /** Read by the editor too, which has to keep the popover inside the stage. */
  popoverWidth: '380px',
  /** The popover's names column: "Pressed border" on one line. */
  popoverNameColumn: '104px',
  /** How far the two dropdown menus (profiles, startup guide) hang below their trigger. */
  menuOffset: '30px',
  /** ProfileBar's two popovers, the active tab's and the one under `+`. */
  menuWidth: '280px',
  /** StartupPopover's onboarding menu — wider, it carries the setup steps. */
  guideWidth: '320px',
  /** The OBS pill's popover: URL, size, port and password (board 3a). */
  statusPopoverWidth: '330px',
  /** The Diagnostics sheet over the stage — wide enough for a log line. */
  sheetWidth: '420px',
  /**
   * The row under the pointer or the one already chosen, in a menu or a list:
   * a step above `popover`, so it reads on the menu it sits in (spec §16.10).
   */
  highlight: '#1B1F2C',
  /** Every menu that floats over the page, so they all sit at one height. */
  shadowMenu: '0 12px 32px rgba(0, 0, 0, 0.45)',
  /** The selection bar, a step lower: it sits on the stage, among the keys. */
  shadowBar: '0 8px 24px rgba(0, 0, 0, 0.45)',
  /** How far a dropdown's menu hangs below its trigger (spec §16.10). */
  dropdownOffset: '6px',
  /** Wide enough for "Triggered color" and its check without wrapping. */
  dropdownMinWidth: '200px',
  /** A scene's profile list sits in a narrower table: it gets less. */
  dropdownSceneMinWidth: '180px',
  /**
   * How long a control takes to change state — background, colour, border —
   * under the pointer (spec §16.13): long enough to read as a response, short
   * enough never to lag the hand.
   */
  stateTransition: '120ms',
  /** The tooltip (board Editor-Tooltip): a step above every surface, so it reads over any of them. */
  tooltip: '#232838',
  /** One sentence, wrapped past this. */
  tooltipMaxWidth: '240px',
} as const;

const CSS_PREFIX = '--he-';

export function cssVariables(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(UI_TOKENS).map(([name, value]) => [
      `${CSS_PREFIX}${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      String(value),
    ]),
  );
}

export function applyTokens(root: {
  style: { setProperty(name: string, value: string): void };
}): void {
  for (const [name, value] of Object.entries(cssVariables())) {
    root.style.setProperty(name, value);
  }
}
