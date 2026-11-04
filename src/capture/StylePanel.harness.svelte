<script lang="ts">
  import { untrack } from 'svelte';
  import StylePanel from './StylePanel.svelte';
  import type { OverlayConfig } from '../config/schema';
  import type { LocalFonts } from './local-fonts';

  /** The panel wired the way App wires it: every change comes back as the new config. */
  let { initial, localFonts }: { initial: OverlayConfig; localFonts?: LocalFonts } = $props();
  // The starting value only: from then on the panel's own changes drive it.
  let config = $state(untrack(() => initial));
</script>

<StylePanel {config} onChange={(next) => (config = next)} {localFonts} />
