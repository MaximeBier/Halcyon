<script lang="ts">
  import Sheet from './Sheet.svelte';

  /** Sheet takes a snippet, which a test cannot hand over directly. */
  let { onClose }: { onClose: () => void } = $props();
</script>

<Sheet title="Diagnostics" {onClose}>
  <p>the contents</p>
</Sheet>
