/**
 * The interface's icons (spec §16.13): Lucide, and only these. Components
 * import from here, never from the package — one place says which icons the
 * page draws, and each comes in by its own path, so the bundle carries the
 * twenty and not the package's sixteen hundred.
 *
 * Sizes are the caller's (16 by default, 14 for chevrons, the reset and the
 * direction arrows, 12 filled for Stop capture); the stroke is Lucide's own
 * and the colour `currentColor`, so an icon always wears its button's text.
 *
 * Not the icons someone puts on a key (Label › Icon): those are text, drawn
 * by the overlay and stored in profiles (spec §8.6).
 */
export { default as Undo2 } from '@lucide/svelte/icons/undo-2';
export { default as Redo2 } from '@lucide/svelte/icons/redo-2';
export { default as Settings } from '@lucide/svelte/icons/settings';
export { default as Ellipsis } from '@lucide/svelte/icons/ellipsis';
export { default as X } from '@lucide/svelte/icons/x';
export { default as Trash2 } from '@lucide/svelte/icons/trash-2';
export { default as Pencil } from '@lucide/svelte/icons/pencil';
export { default as Check } from '@lucide/svelte/icons/check';
export { default as Plus } from '@lucide/svelte/icons/plus';
export { default as Square } from '@lucide/svelte/icons/square';
export { default as ChevronDown } from '@lucide/svelte/icons/chevron-down';
export { default as ChevronUp } from '@lucide/svelte/icons/chevron-up';
export { default as ChevronRight } from '@lucide/svelte/icons/chevron-right';
export { default as ArrowUp } from '@lucide/svelte/icons/arrow-up';
export { default as ArrowDown } from '@lucide/svelte/icons/arrow-down';
export { default as ArrowLeft } from '@lucide/svelte/icons/arrow-left';
export { default as ArrowRight } from '@lucide/svelte/icons/arrow-right';
export { default as RotateCcw } from '@lucide/svelte/icons/rotate-ccw';
export { default as Copy } from '@lucide/svelte/icons/copy';
export { default as Gamepad2 } from '@lucide/svelte/icons/gamepad-2';
export { default as Link } from '@lucide/svelte/icons/link';
export { default as ArrowRightLeft } from '@lucide/svelte/icons/arrow-right-left';
export { default as Power } from '@lucide/svelte/icons/power';
export { default as ListChecks } from '@lucide/svelte/icons/list-checks';
