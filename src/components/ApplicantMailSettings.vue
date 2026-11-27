<script setup lang="ts">
import { onMounted, ref } from "vue";
import { applicantMailDelays, type ApplicantMailSettings } from "../../lib/olympiad";
import { schoolMailSubjectLimit, schoolMailTextLimit } from "../../lib/school-mail";
import { apiFetch } from "../session-api";

const props = defineProps<{ canManage: boolean }>();
const draft = ref<ApplicantMailSettings>();
const setupError = ref("");
const accessCode = ref("");
const pending = ref(false);
const status = ref("");
const error = ref("");
const fieldClass = "min-h-11 rounded-xl border border-line bg-canvas px-3 focus-visible:outline-accent";

async function load(): Promise<void> {
  pending.value = true;
  error.value = "";
  try {
    const response = await apiFetch("/api/olympiad/applicant-mail/settings");
    if (!response.ok) throw new Error();
    const data: { settings: ApplicantMailSettings; setupError?: string } = await response.json();
    draft.value = data.settings;
    setupError.value = data.setupError ?? "";
  } catch {
    error.value = "Не удалось загрузить настройки авторассылки.";
  } finally {
    pending.value = false;
  }
}

async function save(): Promise<void> {
  if (!props.canManage || pending.value || !draft.value) return;
  pending.value = true;
  error.value = "";
  status.value = "";
  try {
    const response = await apiFetch("/api/olympiad/applicant-mail/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft.value, accessCode: accessCode.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки авторассылки.");
    draft.value = data.settings;
    setupError.value = data.setupError ?? "";
    accessCode.value = "";
    status.value = draft.value?.enabled ? "Автоматическая рассылка включена." : "Автоматическая рассылка выключена.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось сохранить настройки авторассылки.";
  } finally {
    pending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section aria-labelledby="settings-applicant-mail" class="min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    @input="status = ''; error = ''">
    <h3 id="settings-applicant-mail" class="text-lg font-semibold">Автоматические рассылки</h3>
    <p v-if="!canManage" class="text-sm text-secondary">Настройки меняет администратор.</p>
    <p v-if="!draft && pending" role="status" class="text-sm text-secondary">Загружаю настройки…</p>
    <template v-if="draft">
      <fieldset class="grid min-w-0 gap-3" :disabled="pending || !canManage">
        <label class="flex items-center gap-2 text-sm font-bold">
          <input v-model="draft.enabled" type="checkbox" class="size-4 accent-accent" :disabled="!!setupError && !draft.enabled" />
          Включить рассылку школьникам
        </label>
        <label class="grid gap-1 text-sm">Срок после регистрации
          <select v-model.number="draft.delayDays" :class="fieldClass">
            <option v-for="days in applicantMailDelays" :key="days" :value="days">{{ days }} дн.</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm">Тема автоматического письма
          <input v-model="draft.subject" :class="fieldClass" :maxlength="schoolMailSubjectLimit" />
        </label>
        <label class="grid gap-1 text-sm">Текст автоматического письма
          <textarea v-model="draft.text" :class="fieldClass" class="resize-y py-2" rows="3" :maxlength="schoolMailTextLimit" />
        </label>
        <label v-if="draft.enabled && canManage" class="grid gap-1 text-sm">Код отправки писем
          <input v-model="accessCode" type="password" autocomplete="off" :class="fieldClass" />
        </label>
      </fieldset>
      <button v-if="canManage" type="button" :disabled="pending || (draft.enabled && !!setupError)"
        class="min-h-11 rounded-ui border border-line px-4 text-sm font-bold text-accent hover:bg-accent-soft disabled:opacity-50"
        @click="save">Сохранить авторассылку</button>
    </template>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <button v-if="error && !draft" type="button" class="min-h-11 text-sm font-bold text-accent" @click="load">Повторить загрузку</button>
    <p v-if="status" role="status" class="text-sm text-accent">{{ status }}</p>
  </section>
</template>
