<!--
  A sentence that explains a setting (spec §16.13, board System › Contrôles).

  Never drawn like the name of a setting: 14 px, muted, in Archivo's own
  italic, the words alone. No icon in front any more — it pushed the words off
  the left edge of the setting they explain. Placed 4 px under that setting:
  the caller's layout does that, with `he-with-help` around the two. The look
  is one shared class, `he-help` (controls.css), not this component's.

  A span, not a paragraph, so it can sit inside the label of the field it
  explains; the class makes it a block.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<span class="he-help">{@render children()}</span>
