<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { FileKind } from '../../src/core/types';
import type { HostMessage, StateMessage } from '../../src/webview/protocol';
import ActionBar from './components/ActionBar.vue';
import FilesTab from './components/FilesTab.vue';
import PackagesTab from './components/PackagesTab.vue';
import { t, warningText } from './i18n';
import { filesToDelete, formatSize, groupByModule, pruneSelection, uninstallCommand } from './model';
import { hasSavedState, loadState, saveState, send, type ViewState } from './vscode';

const saved = loadState();
const shouldApplyCollapseDefault = !hasSavedState();
let collapseDefaultApplied = false;
const view = reactive<ViewState>(saved);
const state = ref<StateMessage>({ type: 'state', lang: 'es', status: 'idle', projectFolder: '', canSelectProject: false, trusted: true, busy: null });
const result = computed(() => state.value.result);
const busy = computed(() => state.value.busy !== null);
const folderName = computed(() => state.value.projectFolder.replace(/[\\/]$/, '').split(/[\\/]/).at(-1) || state.value.projectFolder);
const selectedFiles = computed(() => result.value?.files.filter((file) => view.fileSelection.includes(file.path)) ?? []);
const selectedPackages = computed(() => result.value?.packages.filter((pkg) => view.packageSelection.includes(pkg.name)) ?? []);
const deletionPaths = computed(() => filesToDelete(view.fileSelection, result.value?.files ?? []));
const deletionSize = computed(() => {
  const sizes = new Map((result.value?.files ?? []).map((file) => [file.path, file.size]));
  return formatSize(deletionPaths.value.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0), state.value.lang);
});
const command = computed(() => result.value ? uninstallCommand(result.value.packageManager, view.packageSelection) : '');
const subtitle = computed(() => {
  if (!result.value) return '';
  const parts = [...result.value.frameworks, `${result.value.totals.files} ${t(state.value.lang, 'analyzed')}`, `${(result.value.durationMs / 1000).toFixed(1)} s`];
  return parts.join(' · ');
});
const busyText = computed(() => state.value.busy ? t(state.value.lang, ({ files: 'busyFiles', packages: 'busyPackages', undo: 'busyUndo', typecheck: 'busyTypecheck' } as const)[state.value.busy]) : '');

watch(view, () => saveState(view), { deep: true });
function receive(event: MessageEvent<HostMessage>): void {
  if (!event.data || event.data.type !== 'state') return;
  const incoming = event.data;
  if (incoming.result) {
    view.fileSelection = pruneSelection(view.fileSelection, incoming.result.files.map((file) => file.path));
    view.packageSelection = pruneSelection(view.packageSelection, incoming.result.packages.map((pkg) => pkg.name));
    const modules = groupByModule(incoming.result.files).map((group) => group.module);
    view.collapsed = pruneSelection(view.collapsed, modules);
    if (!collapseDefaultApplied) {
      if (shouldApplyCollapseDefault && incoming.result.files.length > 60) view.collapsed = modules;
      collapseDefaultApplied = true;
    }
  }
  state.value = incoming;
}
onMounted(() => { window.addEventListener('message', receive); send({ type: 'ready' }); });
onBeforeUnmount(() => window.removeEventListener('message', receive));
function toggleCollapsed(module: string): void { const set = new Set(view.collapsed); set.has(module) ? set.delete(module) : set.add(module); view.collapsed = [...set]; }
function clearFilters(): void { view.search = ''; view.kinds = []; }
function doAction(): void { if (view.activeTab === 'files') send({ type: 'deleteFiles', paths: [...view.fileSelection] }); else send({ type: 'uninstall', names: [...view.packageSelection] }); }
function lastActionText(): string {
  const action = state.value.lastAction; if (!action) return '';
  return t(state.value.lang, action.kind === 'files' ? 'moved' : 'uninstalled', { n: action.items.length });
}
function typecheckText(): string { return state.value.typecheck ? t(state.value.lang, state.value.typecheck.status) : ''; }
</script>

<template>
  <main v-if="state.status !== 'done' || !result" class="center-screen">
    <div class="welcome">
      <i v-if="state.status === 'analyzing'" class="codicon codicon-loading codicon-modifier-spin hero-icon" aria-hidden="true" />
      <i v-else-if="state.status === 'error'" class="codicon codicon-error hero-icon error" aria-hidden="true" />
      <i v-else class="codicon codicon-search hero-icon" aria-hidden="true" />
      <h1>{{ folderName }}</h1>
      <p v-if="state.status === 'idle'">{{ t(state.lang, 'explain') }}</p>
      <p v-else-if="state.status === 'analyzing'">{{ t(state.lang, 'analyzing') }}</p>
      <p v-else class="error-message">{{ state.error }}</p>
      <div class="welcome-actions">
        <button v-if="state.status === 'idle'" type="button" class="button primary" @click="send({ type: 'analyze' })">{{ t(state.lang, 'analyze') }}</button>
        <template v-else-if="state.status === 'error'"><button type="button" class="button primary" @click="send({ type: 'analyze' })">{{ t(state.lang, 'retry') }}</button><button type="button" class="button secondary" @click="send({ type: 'showLog' })">{{ t(state.lang, 'log') }}</button></template>
        <button v-if="state.canSelectProject && state.status !== 'analyzing'" type="button" class="link-button" @click="send({ type: 'selectProject' })">{{ t(state.lang, 'change') }}</button>
      </div>
    </div>
  </main>
  <div v-else class="results-shell" :class="{ 'has-action': (view.activeTab === 'files' ? view.fileSelection.length : view.packageSelection.length) > 0 }">
    <header class="sticky-header">
      <div class="project-header"><div class="min-width"><h1>{{ result.projectName }}</h1><p class="subtitle ellipsis">{{ subtitle }}</p></div><div class="header-actions"><button type="button" class="link-button" :disabled="busy" @click="send({ type: 'analyze' })"><i class="codicon codicon-refresh" aria-hidden="true" />{{ t(state.lang, 'again') }}</button><button v-if="state.canSelectProject" type="button" class="link-button" :disabled="busy" @click="send({ type: 'selectProject' })">{{ t(state.lang, 'change') }}</button></div></div>
      <div class="tabs" role="tablist"><button type="button" role="tab" :aria-selected="view.activeTab === 'files'" :class="{ active: view.activeTab === 'files' }" @click="view.activeTab = 'files'">{{ t(state.lang, 'files') }} · {{ result.files.length }}</button><button type="button" role="tab" :aria-selected="view.activeTab === 'packages'" :class="{ active: view.activeTab === 'packages' }" @click="view.activeTab = 'packages'">{{ t(state.lang, 'packages') }} · {{ result.packages.length }}</button></div>
    </header>
    <div class="content">
      <div v-for="warning in result.warnings" :key="warning" class="banner warning"><i class="codicon codicon-warning" aria-hidden="true" />{{ warningText(state.lang, warning) }}</div>
      <div v-if="!state.trusted" class="banner warning"><i class="codicon codicon-lock" aria-hidden="true" />{{ t(state.lang, 'untrusted') }}</div>
      <div v-if="state.lastAction" class="banner action-notice"><div><span>{{ lastActionText() }}</span><span v-if="state.lastAction.error" class="error-message"> {{ state.lastAction.error }}</span></div><div class="notice-actions"><button v-if="state.lastAction.undoable" type="button" class="link-button" :disabled="busy" @click="send({ type: 'undo' })">{{ t(state.lang, 'undo') }}</button><button v-if="state.typecheckScript" type="button" class="link-button" :disabled="busy" @click="send({ type: 'typecheck' })">{{ t(state.lang, 'typecheck') }}</button><span v-if="state.typecheck" :class="['type-status', state.typecheck.status]">{{ typecheckText() }}</span></div></div>
      <div v-if="busyText" class="progress"><i class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />{{ busyText }}</div>
      <FilesTab v-if="view.activeTab === 'files'" :files="result.files" :lang="state.lang" :search="view.search" :kinds="view.kinds as FileKind[]" :collapsed="view.collapsed" :selected="view.fileSelection" :disabled="busy" @search="view.search = $event" @kinds="view.kinds = $event" @collapse="toggleCollapsed" @selection="view.fileSelection = $event" @open="send({ type: 'open', path: $event })" @reveal="send({ type: 'reveal', path: $event })" @clear="clearFilters" />
      <PackagesTab v-else :packages="result.packages" :lang="state.lang" :selected="view.packageSelection" :disabled="busy" @selection="view.packageSelection = $event" @open="send({ type: 'open', path: $event })" />
    </div>
    <ActionBar v-if="view.activeTab === 'files' && view.fileSelection.length" tab="files" :lang="state.lang" :count="view.fileSelection.length" :size="deletionSize" :disabled="busy" :trusted="state.trusted" @clear="view.fileSelection = []" @copy="send({ type: 'copy', text: view.fileSelection.join('\n') })" @action="doAction" />
    <ActionBar v-else-if="view.activeTab === 'packages' && view.packageSelection.length" tab="packages" :lang="state.lang" :count="view.packageSelection.length" :command="command" :disabled="busy" :trusted="state.trusted" @clear="view.packageSelection = []" @action="doAction" />
  </div>
</template>
