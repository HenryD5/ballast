<script setup lang="ts">
import type { Lang } from '../../../src/webview/protocol';
import { t } from '../i18n';
defineProps<{ tab: 'files' | 'packages'; lang: Lang; count: number; size?: string; command?: string; disabled: boolean; trusted: boolean }>();
const emit = defineEmits<{ clear: []; copy: []; action: [] }>();
</script>
<template>
  <footer class="action-bar"><div class="action-inner"><div class="action-summary"><strong>{{ count }} {{ t(lang, 'selected') }}<template v-if="size"> · {{ size }}</template></strong><code v-if="command" class="command">{{ command }}</code></div><div class="action-buttons"><button type="button" class="link-button" :disabled="disabled" @click="emit('clear')">{{ t(lang, 'deselect') }}</button><button v-if="tab === 'files'" type="button" class="button secondary" :disabled="disabled" @click="emit('copy')">{{ t(lang, 'copyPaths') }}</button><button type="button" class="button danger" :disabled="disabled || !trusted" @click="emit('action')"><i class="codicon codicon-trash" aria-hidden="true" />{{ t(lang, tab === 'files' ? 'trash' : 'uninstall', { n: count }) }}</button></div></div></footer>
</template>
