<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { SchoolReply } from "../../lib/school-mail";
import { fetchSchoolReplies } from "../mail-replies";

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{ synced: [replies: SchoolReply[]] }>();
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const replies = ref<SchoolReply[]>([]);
const selectedSchoolId = ref<string>();
const schoolListHeading = ref<HTMLHeadingElement>();
const replyHeading = ref<HTMLHeadingElement>();
const dateFormat = new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" });
const schools = computed(() => {
  const groups = new Map<string, { schoolId: string; name: string; latest: SchoolReply; replies: SchoolReply[] }>();
  for (const reply of replies.value) {
    const school = groups.get(reply.schoolId);
    if (school) school.replies.push(reply);
    else groups.set(reply.schoolId, {
      schoolId: reply.schoolId, name: reply.schoolName, latest: reply, replies: [reply],
    });
  }
  return groups;
});
const selectedSchool = computed(() => selectedSchoolId.value ? schools.value.get(selectedSchoolId.value) : undefined);

async function selectSchool(schoolId: string): Promise<void> {
  selectedSchoolId.value = schoolId;
  await nextTick();
  replyHeading.value?.focus();
}

async function returnToSchools(): Promise<void> {
  selectedSchoolId.value = undefined;
  await nextTick();
  schoolListHeading.value?.focus();
}

async function refresh(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    replies.value = await fetchSchoolReplies();
    loaded.value = true;
    emit("synced", replies.value);
  } catch (cause) {
    error.value = cause instanceof Error && cause.name === "Error" ? cause.message : "Не удалось загрузить ответы.";
  } finally {
    loading.value = false;
  }
}

watch(() => props.active, (active, _, onCleanup) => {
  if (!active) return;
  function refreshIfOpen(): void {
    if (!document.hidden) void refresh();
  }
  refreshIfOpen();
  const timer = window.setInterval(refreshIfOpen, 60_000);
  onCleanup(() => window.clearInterval(timer));
}, { immediate: true });
</script>

<template>
  <section aria-labelledby="school-replies-title" class="rounded-ui border border-line bg-surface p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="school-replies-title" class="text-lg font-semibold">Ответы на письма</h3>
      <button type="button" :disabled="loading"
        class="min-h-11 rounded-ui border border-line px-4 text-sm font-medium text-accent disabled:opacity-50"
        @click="refresh">{{ loading ? "Обновляю…" : "Обновить" }}</button>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-sm text-danger">{{ error }}</p>
    <p v-else-if="loading && !loaded" role="status" class="mt-3 text-sm text-secondary">Загружаю ответы…</p>
    <p v-else-if="loaded && !replies.length" role="status" class="mt-3 text-sm text-secondary">
      Ответов на письма пока нет.
    </p>
    <div v-if="schools.size" class="mt-4 grid border-t border-line [overflow-wrap:anywhere] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div class="min-w-0 py-4 md:border-r md:border-line md:pr-4" :class="{ 'max-md:hidden': selectedSchool }">
        <h4 ref="schoolListHeading" tabindex="-1" class="text-sm font-semibold focus-visible:outline-accent">Учреждения с ответами</h4>
        <ul class="mt-2 space-y-1">
          <li v-for="school in schools.values()" :key="school.schoolId">
            <button type="button"
              class="block min-h-11 w-full rounded-ui border px-3 py-2.5 text-left focus-visible:outline-accent"
              :class="selectedSchoolId === school.schoolId
                ? 'border-accent bg-canvas' : 'border-transparent hover:bg-canvas'"
              :aria-pressed="selectedSchoolId === school.schoolId" @click="selectSchool(school.schoolId)">
              <span class="block text-sm font-medium">{{ school.name }}</span>
              <span class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-secondary">
                <span>Ответов: {{ school.replies.length }}</span>
                <time :datetime="school.latest.receivedAt">{{ dateFormat.format(new Date(school.latest.receivedAt)) }}</time>
              </span>
            </button>
          </li>
        </ul>
      </div>
      <section v-if="selectedSchool" aria-labelledby="selected-school-replies" class="min-w-0 py-4 md:pl-5">
        <button type="button" class="mb-2 min-h-11 text-sm font-medium text-accent md:hidden"
          @click="returnToSchools">← К списку учреждений</button>
        <h4 id="selected-school-replies" ref="replyHeading" tabindex="-1" class="font-semibold focus-visible:outline-accent">
          {{ selectedSchool.name }}
        </h4>
        <ul class="mt-1 divide-y divide-line">
          <li v-for="reply in selectedSchool.replies" :key="reply.id" class="py-4">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h5 class="text-sm font-semibold">{{ reply.subject || "Без темы" }}</h5>
              <time :datetime="reply.receivedAt" class="text-xs text-secondary">{{ dateFormat.format(new Date(reply.receivedAt)) }}</time>
            </div>
            <p class="mt-1 text-xs text-secondary">{{ reply.sender }}</p>
            <p class="mt-3 whitespace-pre-wrap text-sm">{{ reply.text || "Текст письма недоступен." }}</p>
          </li>
        </ul>
      </section>
      <p v-else class="hidden p-5 text-sm text-secondary md:block">Выберите учреждение, чтобы прочитать его ответы.</p>
    </div>
  </section>
</template>
