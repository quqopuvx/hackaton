<script setup lang="ts">
import { responseStatusLabels, type Institution, type InstitutionDetails } from "../../lib/types";
import { institutionTypeLabels } from "../../lib/institution-types";
import { isDirectorySource } from "../../lib/institution-sources";
import { isSingleEmail, schoolMailLimit } from "../../lib/school-mail";

type DisplayRow = InstitutionDetails & Partial<Pick<Institution, "id" | "responseStatus">> & { checkingContacts?: boolean };
defineProps<{
  items: DisplayRow[];
  placeholders: number;
  editable?: boolean;
  mailSelection?: Set<string>;
  mailSelectionLocked?: boolean;
  rowUpdates?: Record<string, { pending?: boolean; message?: string; error?: boolean }>;
}>();
const emit = defineEmits<{ edit: [id: string]; refresh: [id: string]; toggleMail: [id: string]; writeMail: [id: string] }>();
const columnLabels = {
  name: "Название учреждения",
  type: "Тип учреждения",
  city: "Город",
  region: "Регион",
  leader: "Руководитель",
  contacts: "Контактная информация",
  status: "Статус",
};
const mobileLabelClass = "mb-1 block text-xs font-medium text-secondary lg:hidden";
const cellClass = "px-3 py-3 max-lg:p-0";

function sourceLabel(source: string): string {
  const host = new URL(source).hostname.replace(/^www\./, "");
  return isDirectorySource(source) ? `Общий реестр · ${host}` : host;
}

function orderedSources(sources: string[]): string[] {
  return [...sources].sort((left, right) => Number(isDirectorySource(left)) - Number(isDirectorySource(right)));
}
</script>

<template>
  <div class="institution-table" :class="{ 'institution-table--editable': editable }">
    <table role="table" class="w-full text-left text-sm [overflow-wrap:anywhere] max-lg:block lg:table-fixed">
      <thead role="rowgroup" class="border-b border-line bg-canvas/60 text-xs text-accent max-lg:sr-only">
        <tr role="row">
          <th v-for="(label, key) in columnLabels" :key="key" role="columnheader" scope="col" class="px-3 py-3">
            {{ label }}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup" class="divide-y divide-line max-lg:block">
        <tr v-for="(item, index) in items" :key="item.id ?? JSON.stringify([item.name, item.city, item.region])" role="row"
          class="result-row align-top max-lg:grid max-lg:grid-cols-2 max-lg:gap-x-4 max-lg:gap-y-3"
          :style="{ '--row-delay': `${Math.min(index, 7) * 80}ms` }">
          <th scope="row" role="rowheader" class="col-span-2 text-base font-semibold lg:text-sm"
            :class="[cellClass, { 'institution-name--editable': editable && item.id }]">
            {{ item.name }}
            <template v-if="editable && item.id">
              <div class="row-actions">
                <button type="button" class="row-action" title="Редактировать"
                  :aria-label="`Редактировать ${item.name}`" @click="emit('edit', item.id)">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round" class="size-3.5">
                    <path d="m14 6 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z" />
                  </svg>
                </button>
                <button type="button" :disabled="rowUpdates?.[item.id]?.pending"
                  class="row-action" :title="rowUpdates?.[item.id]?.pending ? 'Обновляю данные' : 'Обновить данные'"
                  :aria-label="`${rowUpdates?.[item.id]?.pending ? 'Обновляю данные' : 'Обновить данные'}: ${item.name}`"
                  :aria-busy="rowUpdates?.[item.id]?.pending"
                  @click="emit('refresh', item.id)">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round" class="size-3.5"
                    :class="{ 'motion-safe:animate-spin': rowUpdates?.[item.id]?.pending }">
                    <path d="M20 4v5h-5M4 20v-5h5M20 9a8 8 0 0 0-13.6-2.6L4 9m0 6a8 8 0 0 0 13.6 2.6L20 15" />
                  </svg>
                </button>
              </div>
              <p v-if="rowUpdates?.[item.id]?.message" :role="rowUpdates[item.id].error ? 'alert' : 'status'"
                class="text-xs font-normal" :class="rowUpdates[item.id].error ? 'text-danger' : 'text-secondary'">
                {{ rowUpdates[item.id].message }}
              </p>
            </template>
            <div v-if="item.institutionType === 'school' && item.schoolEnrollment"
              class="mt-3 rounded-ui bg-canvas px-4 py-3 text-xs font-normal">
              <p v-if="item.schoolEnrollment.upperGrades !== null" class="font-semibold">
                10–11 классы: {{ item.schoolEnrollment.upperGrades }}
              </p>
              <p v-if="item.schoolEnrollment.grade10 !== null || item.schoolEnrollment.grade11 !== null"
                class="mt-1 flex flex-wrap gap-x-2 text-secondary">
                <span v-if="item.schoolEnrollment.grade10 !== null">10 класс — {{ item.schoolEnrollment.grade10 }}</span>
                <span v-if="item.schoolEnrollment.grade11 !== null">11 класс — {{ item.schoolEnrollment.grade11 }}</span>
              </p>
              <p v-if="item.schoolEnrollment.total !== null" class="mt-1">Всего учащихся: {{ item.schoolEnrollment.total }}</p>
              <p v-if="item.schoolEnrollment.academicYear" class="mt-1 text-secondary">{{ item.schoolEnrollment.academicYear }} учебный год</p>
              <a :href="item.schoolEnrollment.sourceUrl" target="_blank" rel="noopener noreferrer"
                class="mt-1 inline-block text-accent underline underline-offset-2">Источник численности</a>
            </div>
            <p v-else-if="item.institutionType === 'school' && item.id" class="mt-2 text-xs font-normal text-secondary">
              Численность учащихся не подтверждена.
            </p>
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
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.region }}</span>
            {{ item.region }}
          </td>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.leader }}</span>
            <span v-if="item.checkingContacts && !item.leaderName" class="motion-safe:animate-pulse text-secondary">Проверяю…</span>
            <template v-else>{{ item.leaderName ?? "—" }}</template>
          </td>
          <td role="cell" :class="cellClass">
            <span aria-hidden="true" :class="mobileLabelClass">{{ columnLabels.contacts }}</span>
            <div class="space-y-1">
              <p v-if="item.institutionEmail">{{ item.institutionEmail }}</p>
              <p v-if="item.institutionPhone">{{ item.institutionPhone }}</p>
              <p v-if="item.checkingContacts && (!item.institutionEmail || !item.institutionPhone)"
                class="text-secondary motion-safe:animate-pulse">Проверяю контакты…</p>
              <p v-else-if="!item.institutionEmail && !item.institutionPhone" class="text-secondary">Не найдены</p>
            </div>
          </td>
          <td role="cell" class="institution-status col-span-2 text-center align-middle" :class="cellClass">
            <span aria-hidden="true" class="text-left" :class="mobileLabelClass">{{ columnLabels.status }}</span>
            <span class="row-status" :data-status="item.responseStatus">
              {{ item.responseStatus ? responseStatusLabels[item.responseStatus] : "Сохраняю…" }}
            </span>
            <Transition name="mail-action">
              <div v-if="mailSelection && !mailSelection.size && item.id &&
                isSingleEmail(item.institutionEmail?.trim() ?? '')"
                class="mail-action-collapse">
                <div class="mail-action-inner">
                  <button type="button" class="row-mail mx-auto" :aria-label="'Подготовить письмо: ' + item.name"
                    :disabled="mailSelectionLocked || (!mailSelection.has(item.id) && mailSelection.size >= schoolMailLimit)"
                    @click="emit('writeMail', item.id)">К письму</button>
                </div>
              </div>
            </Transition>
            <label v-if="mailSelection && item.id"
              class="registry-mail-choice justify-center">
              <input type="checkbox" class="size-4 shrink-0 accent-accent" :checked="mailSelection.has(item.id)"
                :aria-label="`Выбрать для письма: ${item.name}`"
                :disabled="mailSelectionLocked || (!mailSelection.has(item.id) &&
                  (mailSelection.size >= schoolMailLimit || !isSingleEmail(item.institutionEmail?.trim() ?? '')))"
                @change="emit('toggleMail', item.id)" />
              {{ isSingleEmail(item.institutionEmail?.trim() ?? '') ? "Выбрать для письма" : "Добавьте почту для отправки" }}
            </label>
          </td>
        </tr>
        <tr v-for="row in placeholders" :key="`placeholder-${row}`" aria-hidden="true"
          class="max-lg:grid max-lg:grid-cols-2 max-lg:gap-4">
          <template v-for="(width, column) in ['w-3/4', 'w-2/3', 'w-1/2', 'w-2/3', 'w-3/4', 'w-full', 'w-2/3']"
            :key="column">
            <td :class="[cellClass, { 'col-span-2': column === 0 || column === 6 }]">
              <span class="block h-3 max-w-36 rounded-ui bg-line motion-safe:animate-pulse" :class="width"
                :style="{ animationDelay: `${row * 140 + column * 65}ms` }" />
            </td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.institution-table--editable {
  margin-inline-start: 1.5rem;
  overflow: visible;
}

.institution-table--editable thead {
  clip-path: inset(0 round calc(var(--radius-ui) - 1px) calc(var(--radius-ui) - 1px) 0 0);
}

.institution-name--editable {
  position: relative;
  block-size: 4.625rem;
}

.row-actions {
  position: absolute;
  inset-block-start: 0.375rem;
  inset-inline-start: calc(-1rem - 1px);
  display: grid;
  gap: 0.125rem;
}

.row-action {
  display: grid;
  inline-size: 2rem;
  block-size: 2rem;
  place-items: center;
  color: var(--color-accent);
}

.row-action::before,
.row-action svg {
  grid-area: 1 / 1;
}

.row-action::before {
  content: "";
  inline-size: 1.5rem;
  block-size: 1.5rem;
  border: 1px solid var(--color-line);
  border-radius: 50%;
  background-color: var(--color-surface);
}

.row-action:enabled:hover::before {
  border-color: var(--color-accent);
  background-color: var(--color-accent-soft);
}

.row-action:focus-visible::before {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.row-action:disabled {
  opacity: 0.65;
}

@media (min-width: 64rem) {
  .institution-table td.institution-status {
    padding: 0.75rem;
  }
}

@media (width < 64rem) {
  .institution-name--editable {
    block-size: auto;
    min-block-size: 4.125rem;
  }

  .row-actions {
    inset-block-start: 0;
    inset-inline-start: calc(-2.25rem - 1px);
  }
}

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
