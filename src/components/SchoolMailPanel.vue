<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isSingleEmail, personalizeSchoolMail, schoolMailDraft, schoolMailLimit, schoolMailTemplates, schoolMailTextLimit, schoolNameToken } from "../../lib/school-mail";
import type { SavedSchoolMailTemplate, SchoolMailOutcome, SchoolMailTemplate } from "../../lib/school-mail";
import type { Institution } from "../../lib/types";

const props = defineProps<{ schools: Institution[]; savedTemplates: SavedSchoolMailTemplate[]; reminderPreset: boolean }>();
const emit = defineEmits<{ lock: []; reset: []; sent: [] }>();
const template = ref(props.reminderPreset ? "reminder" : "");
const draft = ref("");
const selectedTemplate = computed(() => {
  if (Object.hasOwn(schoolMailTemplates, template.value)) {
    const key = template.value as SchoolMailTemplate;
    return { subject: schoolMailTemplates[key], text: schoolMailDraft(key) };
  }
  return props.savedTemplates.find(({ id }) => id === template.value);
});
const subject = ref("");
function restoreTemplate(): void {
  draft.value = selectedTemplate.value?.text ?? "";
  subject.value = selectedTemplate.value?.subject ?? "";
}
watch(template, restoreTemplate, { immediate: true });
const accessCode = ref("");
const previewId = ref("");
const busy = ref(false);
const error = ref("");
const outcomes = ref<SchoolMailOutcome[]>();
const snapshot = ref<{ requestId: string; template: string; schools: Institution[]; text: string; subject: string }>();
const schools = computed(() => snapshot.value?.schools ?? props.schools);
const previewSchool = computed(() => schools.value.find((school) => school.id === previewId.value) ?? schools.value[0]);
const preview = computed(() => subject.value && previewSchool.value ? {
  subject: snapshot.value?.subject ?? subject.value,
  text: personalizeSchoolMail(snapshot.value?.text ?? draft.value, previewSchool.value.name),
} : undefined);
const valid = computed(() => schools.value.every((school) =>
  school.institutionType === "school" && isSingleEmail(school.institutionEmail?.trim() ?? "")));
const canSubmit = computed(() => template.value && subject.value && draft.value.trim() && draft.value.length <= schoolMailTextLimit &&
  valid.value && accessCode.value && !busy.value &&
  (!outcomes.value || outcomes.value.some((result) => result.status === "sending")));
const resultLabels = {
  sent: "Принято почтовым сервером",
  failed: "Почтовый сервер отклонил письмо",
  uncertain: "Отправка не подтверждена. Проверьте почту перед повтором.",
  skipped: "Письмо пропущено",
  sending: "Отправка ещё выполняется",
} satisfies Record<SchoolMailOutcome["status"], string>;
const outcomeById = computed(() => new Map(outcomes.value?.map((outcome) => [outcome.id, outcome])));
const acceptedCount = computed(() => outcomes.value?.filter((outcome) => outcome.status === "sent").length ?? 0);
const controlClass = "min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm text-ink";

async function send(): Promise<void> {
  if (!canSubmit.value || !template.value) return;
  busy.value = true;
  error.value = "";
  try {
    const request = snapshot.value ??= {
      requestId: crypto.randomUUID(), template: template.value, schools: [...props.schools],
      text: draft.value.trim(), subject: subject.value,
    };
    emit("lock");
    const response = await fetch("/api/school-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: request.requestId, template: request.template, accessCode: accessCode.value, text: request.text, subject: request.subject,
        recipients: request.schools.map((school) => ({ id: school.id, email: school.institutionEmail?.trim() })),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      error.value = result.error ?? "Не удалось запросить отправку.";
      return;
    }
    outcomes.value = result.outcomes;
    if (!outcomes.value?.some((outcome) => outcome.status === "sending")) accessCode.value = "";
    emit("sent");
  } catch {
    error.value = "Не удалось получить результат. Повторите проверку этой отправки, чтобы избежать дублей.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section id="school-mail" class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="school-mail-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="school-mail-title" class="text-lg font-semibold">Письма школам</h3>
      <button type="button" class="min-h-11 text-sm font-medium text-accent disabled:opacity-50"
        :disabled="busy" @click="emit('reset')">{{ outcomes ? "Новая рассылка" : "Сбросить выбор" }}</button>
    </div>
    <p class="text-sm text-secondary">Выбрано школ: {{ schools.length }} из {{ schoolMailLimit }}</p>
    <ul class="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm [overflow-wrap:anywhere]">
      <li v-for="school in schools" :key="school.id">
        {{ school.name }} · <span class="text-secondary">{{ school.institutionEmail || "Нет адреса" }}</span>
        <span v-if="outcomeById.has(school.id)" class="block text-xs"
          :class="outcomeById.get(school.id)?.status === 'sent' ? 'text-accent' : 'text-secondary'">
          {{ outcomeById.get(school.id)?.message || resultLabels[outcomeById.get(school.id)!.status] }}
        </span>
      </li>
    </ul>
    <form class="mt-4 space-y-4" @submit.prevent="send">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1 text-sm font-medium">
          Шаблон письма
          <select v-model="template" :class="controlClass" :disabled="!!snapshot">
            <option value="" disabled>Выберите шаблон</option>
            <option v-for="(label, key) in schoolMailTemplates" :key="key" :value="key">{{ label }}</option>
            <optgroup v-if="savedTemplates.length" label="Сохранённые шаблоны">
              <option v-for="saved in savedTemplates" :key="saved.id" :value="saved.id">{{ saved.name }}</option>
            </optgroup>
          </select>
        </label>
        <label v-if="preview && schools.length > 1" class="grid gap-1 text-sm font-medium">
          Предпросмотр для школы
          <select :value="previewSchool?.id" :class="controlClass" @change="previewId = ($event.target as HTMLSelectElement).value">
            <option v-for="school in schools" :key="school.id" :value="school.id">{{ school.name }}</option>
          </select>
        </label>
      </div>
      <div v-if="template && !snapshot" class="grid gap-2">
        <label for="school-mail-text" class="text-sm font-medium">Текст письма</label>
        <textarea id="school-mail-text" v-model="draft" rows="7" :maxlength="schoolMailTextLimit" required
          aria-describedby="school-mail-personalization" :class="controlClass" class="resize-y py-3" />
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-secondary">
          <p id="school-mail-personalization">Вместо <code>{{ schoolNameToken }}</code> подставится название школы.</p>
          <button type="button" class="min-h-11 font-medium text-accent" @click="restoreTemplate">
            Восстановить шаблон
          </button>
        </div>
      </div>
      <div v-if="preview" class="rounded-xl border border-line bg-canvas p-4 text-sm [overflow-wrap:anywhere]">
        <p class="mb-2 text-xs font-medium text-secondary">Предпросмотр</p>
        <p class="font-semibold">{{ preview.subject }}</p>
        <p class="mt-2 whitespace-pre-wrap">{{ preview.text }}</p>
      </div>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <p v-if="!valid" role="alert" class="text-sm text-danger">В выбранном списке есть школа с изменёнными данными. Проверьте карточки.</p>
      <p v-if="outcomes" role="status" class="text-sm font-medium">Почтовый сервер принял {{ acceptedCount }} из {{ schools.length }} писем.</p>
      <div v-if="preview && (!outcomes || outcomes.some((outcome) => outcome.status === 'sending'))"
        class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1 text-sm font-medium">
          Код доступа к отправке
          <input v-model="accessCode" :class="controlClass" type="password" autocomplete="off" :disabled="busy" required />
        </label>
        <button type="submit" :disabled="!canSubmit"
          class="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
          {{ busy ? "Отправка…" : snapshot ? "Повторить запрос отправки" : "Подтвердить и отправить" }}
        </button>
      </div>
    </form>
  </section>
</template>
