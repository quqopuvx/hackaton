<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isSingleEmail, schoolMailLimit } from "../../lib/school-mail";
import type { Institution } from "../../lib/types";
import SchoolMailPanel from "./SchoolMailPanel.vue";
import SchoolRepliesPanel from "./SchoolRepliesPanel.vue";

const props = defineProps<{
  institutions: Institution[];
  selected: Set<string>;
  selectedSchools: Institution[];
  locked: boolean;
  loading: boolean;
  error: string;
  active: boolean;
  composeRequest: number;
}>();

const emit = defineEmits<{ toggle: [id: string]; lock: []; reset: []; sent: [] }>();
const query = ref("");
const panel = ref<"compose" | "replies">("compose");
watch(() => props.composeRequest, () => { panel.value = "compose"; });
const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е");
const schools = computed(() => props.institutions.filter((school) => school.institutionType === "school"));
const visibleSchools = computed(() => {
  const terms = normalize(query.value).trim().split(/\s+/).filter(Boolean);
  return schools.value.filter((school) => {
    const text = normalize([school.name, school.city, school.region, school.institutionEmail].join(" "));
    return terms.every((term) => text.includes(term));
  });
});
</script>

<template>
  <section aria-labelledby="mail-page-title"
    class="min-h-0 w-full flex-1 overflow-y-auto pt-4 pb-5 [scrollbar-gutter:stable] sm:pt-5">
    <h2 id="mail-page-title" class="mb-4 text-xl font-semibold sm:text-2xl">Почта</h2>
    <nav aria-label="Разделы почты" class="mb-4 flex flex-wrap gap-2 border-b border-line">
      <button type="button" class="min-h-11 border-b-2 px-3 text-sm font-semibold" :aria-pressed="panel === 'compose'"
        :class="panel === 'compose' ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="panel = 'compose'">Отправка</button>
      <button type="button" class="min-h-11 border-b-2 px-3 text-sm font-semibold" :aria-pressed="panel === 'replies'"
        :class="panel === 'replies' ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="panel = 'replies'">Ответы от школ</button>
    </nav>
    <SchoolRepliesPanel v-show="panel === 'replies'" :active="active && panel === 'replies'" @synced="emit('sent')" />
    <div v-show="panel === 'compose'" class="grid items-start gap-4 lg:grid-cols-2">
      <section class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="mail-recipients-title">
        <h3 id="mail-recipients-title" class="text-lg font-semibold">Выбор школ</h3>
        <label class="mt-3 grid gap-1 text-sm font-medium">
          Поиск школы
          <input v-model="query" type="search" placeholder="Название, город, регион или почта"
            class="min-h-11 rounded-xl border border-line bg-canvas px-3 text-sm focus-visible:outline-accent" />
        </label>
        <p class="mt-3 text-sm text-secondary" aria-live="polite">Выбрано {{ selected.size }} из {{ schoolMailLimit }}</p>
        <p v-if="error" role="alert" class="mt-3 text-sm text-danger">{{ error }}</p>
        <p v-else-if="loading && !schools.length" class="mt-3 text-sm text-secondary">Загружаю школы…</p>
        <p v-else-if="!schools.length" class="mt-3 text-sm text-secondary">
          В реестре пока нет школ. Найдите школы в разделе «Результаты поиска».
        </p>
        <p v-else-if="!visibleSchools.length" class="mt-3 text-sm text-secondary">По запросу школы не найдены.</p>
        <ul v-else class="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto">
          <li v-for="school in visibleSchools" :key="school.id">
            <label class="flex min-h-12 items-start gap-3 py-3 text-sm [overflow-wrap:anywhere]">
              <input type="checkbox" class="mt-0.5 size-4 shrink-0 accent-accent" :checked="selected.has(school.id)"
                :aria-label="`Выбрать для письма: ${school.name}`"
                :disabled="locked || (!selected.has(school.id) &&
                  (selected.size >= schoolMailLimit || !isSingleEmail(school.institutionEmail?.trim() ?? '')))"
                @change="emit('toggle', school.id)" />
              <span class="min-w-0">
                <span class="font-medium">{{ school.name }}</span>
                <span class="block text-xs text-secondary">{{ school.city }} · {{ school.region }}</span>
                <span class="block text-xs text-secondary">
                  {{ isSingleEmail(school.institutionEmail?.trim() ?? '') ? school.institutionEmail : "Добавьте почту в карточке школы" }}
                </span>
              </span>
            </label>
          </li>
        </ul>
      </section>
      <SchoolMailPanel v-if="selectedSchools.length" :schools="selectedSchools"
        @lock="emit('lock')" @reset="emit('reset')" @sent="emit('sent')" />
      <section v-else class="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h3 class="text-lg font-semibold">Письма школам</h3>
        <p class="mt-2 text-sm text-secondary">Отметьте хотя бы одну школу, чтобы выбрать шаблон и посмотреть письмо.</p>
      </section>
    </div>
  </section>
</template>
