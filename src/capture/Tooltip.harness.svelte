<script lang="ts">
  import Tooltip from './Tooltip.svelte';

  let { text }: { text: string | null } = $props();
</script>

<Tooltip {text}>
  {#snippet children(describedBy)}
    <button type="button" aria-describedby={describedBy}>Undo</button>
  {/snippet}
</Tooltip>
