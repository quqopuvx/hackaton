<script setup lang="ts">
import { responseStatusLabels, type Institution, type InstitutionDetails } from "../../lib/types";
import { institutionTypeLabels } from "../../lib/institution-types";
import { isDirectorySource } from "../../lib/institution-sources";

type DisplayRow = InstitutionDetails & Partial<Pick<Institution, "id" | "responseStatus">> & { checkingContacts?: boolean };
withDefaults(defineProps<{
  items: DisplayRow[];
  placeholders: number;
  showRegion?: boolean;
  editable?: boolean;
  rowUpdates?: Record<string, { pending?: boolean; message?: string; error?: boolean }>;
}>(), { showRegion: true });
const emit = defineEmits<{ edit: [id: string]; refresh: [id: string] }>();
const columnLabels = {
  name: "Название учреждения",
  type: "Тип учреждения",
  city: "Город",
  region: "Регион",
  leader: "Руководитель",
  email: "Почта учреждения",
  phone: "Телефон учреждения",
  status: "Статус ответа",
};
const mobileLabelClass = "mb-1 block text-xs font-medium text-secondary lg:hidden";
const cellClass = "px-3 py-4 max-lg:p-0 xl:px-4";

function sourceLabel(source: string): string {
  const host = new URL(source).hostname.replace(/^www\./, "");
  return isDirectorySource(source) ? `Общий реестр · ${host}` : host;
}

function orderedSources(sources: string[]): string[] {
  return [...sources].sort((left, right) => Number(isDirectorySource(left)) - Number(isDirectorySource(right)));
}
</script>

<template>
  <div class="relative mt-4 overflow-hidden rounded-2xl border border-line bg-surface lg:rounded-[2rem]">
    <table role="table" class="w-full text-left text-sm [overflow-wrap:anywhere] max-lg:block">
      <thead role="rowgroup" class="border-b border-line bg-canvas/70 text-xs text-secondary max-lg:sr-only">
        <tr role="row">
          <template v-for="(label, key) in columnLabels" :key="key">
            <th v-if="key !== 'region' || showRegion" role="columnheader" scope="col" class="px-3 py-4 xl:px-4">
              {{ label }}
            </th>
          </template>
        </tr>
      </thead>
      <tbody role="rowgroup" class="divide-y divide-line max-lg:block">
        <tr v-for="(item, index) in items" :key="item.id ?? JSON.stringify([item.name, item.city, item.region])" role="row"
          class="result-row align-top max-lg:grid max-lg:grid-cols-2 max-lg:gap-x-4 max-lg:gap-y-3 max-lg:p-4"
          :style="{ '--row-delay': `${Math.min(index, 7) * 80}ms` }">
          <th scope="row" role="rowheader" class="col-span-2 text-base font-semibold lg:text-sm" :class="cellClass">
            {{ item.name }}
            <template v-if="editable && item.id">
              <div class="mt-1 flex flex-wrap gap-x-3">
                <button type="button" class="min-h-11 text-left text-xs font-medium text-accent underline underline-offset-2"
                  :aria-label="`Редактировать ${item.name}`" @click="emit('edit', item.id)">
                  Редактировать
                </button>
                <button type="button" :disabled="rowUpdates?.[item.id]?.pending"
                  class="min-h-11 text-left text-xs font-medium text-accent underline underline-offset-2 disabled:opacity-50"
                  :aria-label="`${rowUpdates?.[item.id]?.pending ? 'Обновляю данные' : 'Обновить данные'}: ${item.name}`"
                  @click="emit('refresh', item.id)">
                  {{ rowUpdates?.[item.id]?.pending ? "Обновляю…" : "Обновить данные" }}
                </button>
              </div>
              <p v-if="rowUpdates?.[item.id]?.message" :role="rowUpdates[item.id].error ? 'alert' : 'status'"
                class="text-xs font-normal" :class="rowUpdates[item.id].error ? 'text-danger' : 'text-secondary'">
                {{ rowUpdates[item.id].message }}
              </p>
            </template>
            <div v-if="item.sourceUrls.length" class="mt-2 flex flex-wrap items-start gap-x-3 gap-y-2 text-xs font-normal lg:flex-col">
              <a
                v-for="source in orderedSources(item.sourceUrls)"
                :key="source"
                :href="source"
                :title="source"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent underline underline-offset-2"
              >{{ sourceLabel(source) }}</a>
            </div>
          </th>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.type }}</span>
            {{ item.institutionType ? institutionTypeLabels[item.institutionType] : "Не указан" }}
          </td>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.city }}</span>
            {{ item.city }}
          </td>
          <td v-if="showRegion" role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.region }}</span>
            {{ item.region }}
          </td>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.leader }}</span>
            <span v-if="item.checkingContacts && !item.leaderName" class="motion-safe:animate-pulse text-secondary">Проверяю…</span>
            <template v-else>{{ item.leaderName ?? "—" }}</template>
          </td>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.email }}</span>
            <span v-if="item.checkingContacts && !item.institutionEmail" class="motion-safe:animate-pulse text-secondary">Проверяю…</span>
            <template v-else>{{ item.institutionEmail ?? "Не найдено" }}</template>
          </td>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.phone }}</span>
            <span v-if="item.checkingContacts && !item.institutionPhone" class="motion-safe:animate-pulse text-secondary">Проверяю…</span>
            <template v-else>{{ item.institutionPhone ?? "Не найдено" }}</template>
          </td>
          <td role="cell" class="col-span-2" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.status }}</span>
            <span class="text-secondary">{{ item.responseStatus ? responseStatusLabels[item.responseStatus] : "Сохраняю…" }}</span>
            <button
              v-if="item.responseStatus"
              type="button"
              disabled
              title="Отправка писем пока недоступна"
              class="mt-2 block min-h-11 rounded-xl border border-line px-3 text-xs text-muted"
            >Отправить</button>
          </td>
        </tr>
        <tr v-for="row in placeholders" :key="`placeholder-${row}`" aria-hidden="true"
          class="max-lg:grid max-lg:grid-cols-2 max-lg:gap-4 max-lg:p-4">
          <template v-for="(width, column) in ['w-3/4', 'w-2/3', 'w-1/2', 'w-2/3', 'w-3/4', 'w-full', 'w-3/4', 'w-2/3']"
            :key="column">
            <td v-if="column !== 3 || showRegion" :class="[cellClass, { 'col-span-2': column === 0 || column === 7 }]">
              <span class="block h-3 max-w-36 rounded-full bg-line motion-safe:animate-pulse" :class="width"
                :style="{ animationDelay: `${row * 140 + column * 65}ms` }" />
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .result-row {
    animation: reveal-row 220ms ease-out var(--row-delay) both;
  }
}

@keyframes reveal-row {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
