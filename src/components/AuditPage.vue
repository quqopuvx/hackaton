<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { accountRoleLabels, auditActionLabels, type AuditEntry } from "../../lib/accounts";
import { apiFetch } from "../session-api";

const events = ref<AuditEntry[]>([]);
const loading = ref(true);
const error = ref("");
const dateFormat = new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" });
let request: AbortController | undefined;

async function refresh(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const response = await apiFetch("/api/audit", { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить журнал.");
    if (!controller.signal.aborted) events.value = data.events;
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : "Не удалось загрузить журнал.";
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

onMounted(refresh);
onUnmounted(() => request?.abort());
</script>

<template>
  <section class="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="audit-list">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="audit-list" class="text-lg font-semibold">Последние действия</h3>
      <button type="button" :disabled="loading" class="min-h-11 rounded-ui border border-line px-4 text-sm font-medium text-accent disabled:opacity-50"
        @click="refresh">{{ loading ? "Загружаю…" : "Обновить" }}</button>
    </div>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-else-if="loading && !events.length" class="mt-2 text-sm text-secondary" role="status">Загружаю журнал…</p>
    <p v-else-if="!events.length" class="mt-2 text-sm text-secondary">Действий пока нет.</p>
    <ol v-if="events.length" class="mt-2 divide-y divide-line [overflow-wrap:anywhere]">
      <li v-for="event in events" :key="event.id" class="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)_auto]">
        <div>
          <p class="font-semibold">{{ event.name }}</p>
          <p class="text-xs text-secondary">{{ event.username }} · {{ accountRoleLabels[event.role] }}</p>
        </div>
        <div>
          <p class="font-semibold">{{ auditActionLabels[event.action] }}</p>
          <p v-if="event.details" class="text-xs text-secondary">{{ event.details }}</p>
        </div>
        <time :datetime="event.occurredAt" class="text-xs text-secondary">{{ dateFormat.format(new Date(event.occurredAt)) }}</time>
      </li>
    </ol>
  </section>
</template>
