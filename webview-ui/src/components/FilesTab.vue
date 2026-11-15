<script setup lang="ts">
import { computed } from 'vue';
import type { FileKind, UnusedFile } from '../../../src/core/types';
import type { Lang } from '../../../src/webview/protocol';
import { fileReasonText, kindText, t } from '../i18n';
import { filterFiles, formatSize, groupByModule, groupSelectionState, kindCounts } from '../model';

const props = defineProps<{ files: UnusedFile[]; lang: Lang; search: string; kinds: FileKind[]; collapsed: string[]; selected: string[]; disabled: boolean }>();
const emit = defineEmits<{ search: [value: string]; kinds: [value: FileKind[]]; collapse: [module: string]; selection: [paths: string[]]; open: [path: string]; reveal: [path: string]; clear: [] }>();
const counts = computed(() => kindCounts(props.files));
const presentKinds = computed(() => (Object.entries(counts.value) as [FileKind, number][]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const visible = computed(() => filterFiles(props.files, { search: props.search, kinds: props.kinds }));
const groups = computed(() => groupByModule(visible.value));
const selectedSet = computed(() => new Set(props.selected));
const isFiltered = computed(() => Boolean(props.search.trim() || props.kinds.length));

function toggleKind(kind: FileKind): void {
  const next = new Set(props.kinds); next.has(kind) ? next.delete(kind) : next.add(kind); emit('kinds', [...next]);
}
function toggle(path: string): void { const next = new Set(props.selected); next.has(path) ? next.delete(path) : next.add(path); emit('selection', [...next]); }
function toggleGroup(files: UnusedFile[]): void {
  const next = new Set(props.selected); const keys = files.map((file) => file.path); const all = keys.every((key) => next.has(key));
  for (const key of keys) all ? next.delete(key) : next.add(key); emit('selection', [...next]);
}
function toggleAll(): void {
  const next = new Set(props.selected); const all = visible.value.every((file) => next.has(file.path));
  for (const file of visible.value) all ? next.delete(file.path) : next.add(file.path); emit('selection', [...next]);
}
function relativeDir(file: UnusedFile, hint: string): string { return hint && file.dir.startsWith(hint) ? file.dir.slice(hint.length).replace(/^\//, '') || '.' : file.dir || '.'; }
function names(paths: string[]): string { return paths.map((path) => path.split('/').at(-1)).join(', '); }
function setIndeterminate(element: unknown, value: boolean): void { if (element instanceof HTMLInputElement) element.indeterminate = value; }
</script>

<template>
  <section class="tab-panel" role="tabpanel">
    <div class="filters">
      <label class="search"><i class="codicon codicon-search" aria-hidden="true" /><span class="sr-only">{{ t(lang, 'search') }}</span><input :value="search" :placeholder="t(lang, 'search')" @input="emit('search', ($event.target as HTMLInputElement).value)" /></label>
      <div class="chips" aria-label="Filtros">
        <button type="button" class="chip" :class="{ active: kinds.length === 0 }" @click="emit('kinds', [])">{{ t(lang, 'all') }} · {{ files.length }}</button>
        <button v-for="[kind, count] in presentKinds" :key="kind" type="button" class="chip" :class="{ active: kinds.includes(kind) }" @click="toggleKind(kind)">{{ kindText(lang, kind) }} · {{ count }}</button>
      </div>
      <button v-if="visible.length" type="button" class="link-button select-all" :disabled="disabled" @click="toggleAll">{{ t(lang, 'selectAll') }}</button>
    </div>
    <div v-if="!files.length" class="empty"><i class="codicon codicon-check" aria-hidden="true" />{{ t(lang, 'noFiles') }}</div>
    <div v-else-if="!visible.length" class="empty"><span>{{ t(lang, 'noMatch') }}</span><button type="button" class="link-button" @click="emit('clear')">{{ t(lang, 'clear') }}</button></div>
    <div v-else class="groups">
      <section v-for="group in groups" :key="group.module" class="file-group">
        <div class="group-head">
          <button type="button" class="icon-button" :aria-label="group.module" :aria-expanded="!collapsed.includes(group.module)" @click="emit('collapse', group.module)"><i class="codicon" :class="collapsed.includes(group.module) ? 'codicon-chevron-right' : 'codicon-chevron-down'" aria-hidden="true" /></button>
          <input :ref="(el) => setIndeterminate(el, groupSelectionState(group.files.map(f => f.path), selectedSet) === 'some')" type="checkbox" :aria-label="`${t(lang, 'selectAll')}: ${group.module}`" :checked="groupSelectionState(group.files.map(f => f.path), selectedSet) === 'all'" :disabled="disabled" @change="toggleGroup(group.files)" />
          <strong class="ellipsis">{{ group.module }}</strong><span class="muted ellipsis">{{ group.dirHint }}</span><span class="count">{{ group.files.length }}</span>
        </div>
        <div v-if="!collapsed.includes(group.module)">
          <div v-for="file in group.files" :key="file.path" class="file-row">
            <input type="checkbox" :aria-label="file.path" :checked="selectedSet.has(file.path)" :disabled="disabled" @change="toggle(file.path)" />
            <div class="file-main">
              <button type="button" class="link-button mono ellipsis" @click="emit('open', file.path)">{{ file.name }}</button>
              <div class="detail ellipsis"><span>{{ relativeDir(file, group.dirHint) }}</span><span v-if="file.reason === 'onlyTests'">+ {{ file.tests.length }} {{ file.tests.length === 1 ? 'test' : 'tests' }}: {{ names(file.tests) }}</span><span v-else-if="file.reason === 'onlyUnused'">{{ lang === 'es' ? 'usado solo por:' : 'used only by:' }} {{ names(file.importedBy) }}</span></div>
            </div>
            <span class="tag">{{ kindText(lang, file.kind) }}</span><span class="reason">{{ fileReasonText(lang, file.reason) }}</span><span class="size">{{ formatSize(file.size, lang) }}</span>
            <button type="button" class="icon-button" :aria-label="t(lang, 'reveal')" @click="emit('reveal', file.path)"><i class="codicon codicon-folder-opened" aria-hidden="true" /></button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
