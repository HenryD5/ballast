<script setup lang="ts">
import { computed } from 'vue';
import type { UnusedPackage } from '../../../src/core/types';
import type { Lang } from '../../../src/webview/protocol';
import { packageReasonText, t } from '../i18n';
const props = defineProps<{ packages: UnusedPackage[]; lang: Lang; selected: string[]; disabled: boolean }>();
const emit = defineEmits<{ selection: [names: string[]]; open: [path: string] }>();
const selectedSet = computed(() => new Set(props.selected));
function toggle(name: string): void { const next = new Set(props.selected); next.has(name) ? next.delete(name) : next.add(name); emit('selection', [...next]); }
function toggleAll(): void { const next = props.packages.every((item) => selectedSet.value.has(item.name)) ? [] : props.packages.map((item) => item.name); emit('selection', next); }
</script>
<template>
  <section class="tab-panel" role="tabpanel">
    <div v-if="packages.length" class="package-tools"><button type="button" class="link-button" :disabled="disabled" @click="toggleAll">{{ t(lang, 'selectAll') }}</button></div>
    <div v-if="!packages.length" class="empty"><i class="codicon codicon-check" aria-hidden="true" />{{ t(lang, 'noPackages') }}</div>
    <div v-else class="package-list">
      <div v-for="pkg in packages" :key="pkg.name" class="package-row">
        <input type="checkbox" :aria-label="pkg.name" :checked="selectedSet.has(pkg.name)" :disabled="disabled" @change="toggle(pkg.name)" />
        <div class="package-main"><div class="package-title"><span class="mono">{{ pkg.name }}</span><span class="muted">{{ pkg.version }}</span><span class="tag">{{ pkg.section }}</span></div><div class="detail">{{ packageReasonText(lang, pkg.reason) }}</div>
          <div v-if="pkg.reason === 'onlyUnusedFiles'" class="package-files"><div><button v-for="path in pkg.files" :key="path" type="button" class="link-button mono" @click="emit('open', path)">{{ path }}</button></div><div class="warning"><i class="codicon codicon-warning" aria-hidden="true" />{{ t(lang, 'packageWarning') }}</div></div>
        </div>
      </div>
    </div>
  </section>
</template>
