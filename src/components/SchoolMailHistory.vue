<script setup lang="ts">
import { ref, watch } from "vue";
import { isSingleEmail, schoolMailLimit } from "../../lib/school-mail";
import type { SchoolMailHistoryEntry, SchoolMailReminder } from "../../lib/school-mail";

const props = defineProps<{ active: boolean; locked: boolean }>();
const emit = defineEmits<{ prepare: [ids: string[]] }>();
const view = ref<"history" | "reminders">("history");
const page = ref(1);
const days = ref(7);
const reload = ref(0);
const entries = ref<SchoolMailHistoryEntry[]>([]);
const reminders = ref<SchoolMailReminder[]>([]);
const selected = ref(new Set<string>());
const hasMore = ref(false);
const loading = ref(false);
const error = ref("");
const dateFormat = new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" });
const statuses: Record<SchoolMailHistoryEntry["status"], string> = {
  sent: "Почтовый сервер принял",
  failed: "Почтовый сервер отклонил",
  uncertain: "Отправка не подтверждена",
  sending: "Отправляется",
};

watch([() => props.active, view, page, days, reload], async ([active, mode, number, age], _, onCleanup) => {
  if (!active) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  loading.value = true;
  error.value = "";
  try {
    const path = mode === "history" ? `history?page=${number}` : `reminders?days=${age}`;
    const response = await fetch(`/api/school-mail/${path}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить отправки.");
    if (mode === "history") {
      entries.value = data.entries;
      hasMore.value = data.hasMore;
    } else {
      reminders.value = data.schools;
      const eligible = new Set(reminders.value.filter((school) => isSingleEmail(school.email?.trim() ?? "")).map(({ schoolId }) => schoolId));
      selected.value = new Set([...selected.value].filter((id) => eligible.has(id)));
    }
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : "Не удалось загрузить отправки.";
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}, { immediate: true });

function select(id: string): void {
  if (selected.value.has(id)) selected.value.delete(id);
  else if (selected.value.size < schoolMailLimit) selected.value.add(id);
}

function prepare(): void {
  emit("prepare", [...selected.value]);
  selected.value.clear();
}
</script>

<template>
  <section aria-labelledby="mail-history-title" class="min-w-0 rounded-ui border border-line bg-surface p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="mail-history-title" class="text-lg font-semibold">Отправленные письма</h3>
      <button type="button" :disabled="loading" class="min-h-11 rounded-ui border border-line px-4 text-sm text-accent disabled:opacity-50"
        @click="reload++">Обновить</button>
    </div>
    <div class="mt-3 flex flex-wrap gap-2" aria-label="Вид списка">
      <button type="button" class="min-h-11 rounded-ui border px-3 text-sm" :aria-pressed="view === 'history'"
        :class="view === 'history' ? 'border-accent text-accent' : 'border-line'" @click="view = 'history'">Все отправки</button>
      <button type="button" class="min-h-11 rounded-ui border px-3 text-sm" :aria-pressed="view === 'reminders'"
        :class="view === 'reminders' ? 'border-accent text-accent' : 'border-line'" @click="view = 'reminders'">Давно ждут ответа</button>
    </div>
    <div v-if="view === 'reminders'" class="mt-3 flex flex-wrap items-end justify-between gap-3">
      <label class="grid gap-1 text-sm font-medium">
        С последнего письма прошло
        <select v-model.number="days" class="min-h-11 rounded-ui border border-line bg-canvas px-3 text-sm"
          @change="selected.clear()">
          <option :value="7">7 дней и больше</option>
          <option :value="14">14 дней и больше</option>
          <option :value="30">30 дней и больше</option>
        </select>
      </label>
      <button type="button" :disabled="locked || loading || !!error || !selected.size"
        class="min-h-11 rounded-ui bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
        @click="prepare">Подготовить напоминание ({{ selected.size }})</button>
    </div>
    <p v-if="view === 'reminders' && locked" class="mt-2 text-sm text-secondary">Завершите текущую рассылку во вкладке «Отправка».</p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-danger">{{ error }}</p>
    <p v-else-if="loading" role="status" class="mt-4 text-sm text-secondary">Загружаю…</p>
    <template v-else-if="view === 'history'">
      <p v-if="!entries.length" class="mt-4 text-sm text-secondary">На этой странице нет отправок.</p>
      <ul v-else class="mt-4 divide-y divide-line border-t border-line [overflow-wrap:anywhere]">
        <li v-for="entry in entries" :key="entry.id" class="grid gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[1fr_auto]">
          <p class="font-semibold">{{ entry.schoolName }}</p>
          <time :datetime="entry.date" class="text-xs text-secondary sm:text-right">{{ dateFormat.format(new Date(entry.date)) }}</time>
          <p>{{ entry.subject }}</p>
          <p class="text-xs text-secondary sm:text-right">{{ statuses[entry.status] }}</p>
          <p class="text-xs text-secondary">{{ entry.recipient }}</p>
        </li>
      </ul>
      <div v-if="page > 1 || hasMore" class="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button type="button" class="min-h-11 text-accent disabled:opacity-50" :disabled="page === 1" @click="page--">Назад</button>
        <span class="text-secondary">Страница {{ page }}</span>
        <button type="button" class="min-h-11 text-accent disabled:opacity-50" :disabled="!hasMore" @click="page++">Дальше</button>
      </div>
    </template>
    <template v-else>
      <p v-if="!reminders.length" class="mt-4 text-sm text-secondary">По выбранному сроку напоминаний нет.</p>
      <ul v-else class="mt-4 divide-y divide-line border-t border-line [overflow-wrap:anywhere]">
        <li v-for="school in reminders" :key="school.schoolId">
          <label class="flex min-h-11 items-start gap-3 py-3 text-sm">
            <input type="checkbox" class="mt-1 size-4 shrink-0 accent-accent" :checked="selected.has(school.schoolId)"
              :disabled="locked || !isSingleEmail(school.email?.trim() ?? '') ||
                (!selected.has(school.schoolId) && selected.size >= schoolMailLimit)"
              @change="select(school.schoolId)" />
            <span class="min-w-0">
              <span class="block font-semibold">{{ school.schoolName }}</span>
              <span class="block text-xs text-secondary">{{ school.email || "Добавьте почту в реестре" }}</span>
              <span class="block text-xs text-secondary">
                Последнее письмо <time :datetime="school.lastSentAt">{{ dateFormat.format(new Date(school.lastSentAt)) }}</time>
              </span>
            </span>
          </label>
        </li>
      </ul>
    </template>
  </section>
</template>
