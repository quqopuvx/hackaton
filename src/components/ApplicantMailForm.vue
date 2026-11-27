<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { applicantMailBatchLimit, applicantMailTemplates, type ApplicantMailRecipient } from "../../lib/olympiad";
import { schoolMailSubjectLimit, schoolMailTextLimit } from "../../lib/school-mail";
import { apiFetch } from "../session-api";

const props = defineProps<{ recipients: ApplicantMailRecipient[]; setupError: string; bulk?: boolean; allSelected?: boolean }>();
const emit = defineEmits<{ close: []; lock: [] }>();
const subjectField = ref<HTMLInputElement>();
const subject = ref("");
const text = ref("");
const accessCode = ref("");
const sending = ref(false);
const finished = ref(false);
const status = ref("");
const error = ref("");
const template = ref<keyof typeof applicantMailTemplates | "">("");
const batch = ref<{ ids: string[]; handled: number; sent: number; skipped: number; failed: number; uncertain: number }>();
let requestId = crypto.randomUUID();
const fieldClass = "min-h-11 rounded-xl border border-line bg-canvas px-3 focus-visible:outline-accent";

onMounted(async () => {
  await nextTick();
  if (!props.bulk) subjectField.value?.focus();
});

function applyTemplate(): void {
  if (!template.value) return;
  const draft = applicantMailTemplates[template.value];
  subject.value = draft.subject;
  text.value = draft.text;
}

async function sendBatch(): Promise<void> {
  batch.value ??= {
    ids: props.recipients.map(({ id }) => id), handled: 0, sent: 0, skipped: 0, failed: 0, uncertain: 0,
  };
  const current = batch.value;
  emit("lock");
  while (current.handled < current.ids.length) {
    const applicantIds = current.ids.slice(current.handled, current.handled + applicantMailBatchLimit);
    const response = await apiFetch("/api/olympiad/applicant-mail/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, applicantIds, subject: subject.value, text: text.value, accessCode: accessCode.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось отправить письма.");
    for (const outcome of result.outcomes as string[]) {
      if (outcome === "sent" || outcome === "skipped" || outcome === "failed") current[outcome]++;
      else current.uncertain++;
    }
    current.handled += applicantIds.length;
  }
  finished.value = true;
  accessCode.value = "";
  status.value = `Отправлено: ${current.sent}. Пропущено: ${current.skipped}. Ошибок: ${current.failed}. Не подтверждено: ${current.uncertain}.`;
}

async function send(): Promise<void> {
  if (sending.value || finished.value || props.setupError || !props.recipients.length) return;
  sending.value = true;
  error.value = "";
  try {
    if (props.bulk) {
      await sendBatch();
      return;
    }
    const response = await apiFetch("/api/olympiad/applicant-mail", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, applicantId: props.recipients[0].id, subject: subject.value, text: text.value, accessCode: accessCode.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось отправить письмо.");
    if (result.status === "failed") {
      requestId = crypto.randomUUID();
      error.value = "Почтовый сервер отклонил письмо. Можно повторить отправку.";
      return;
    }
    finished.value = true;
    accessCode.value = "";
    if (result.status === "sent") status.value = "Почтовый сервер принял письмо.";
    else if (result.status === "skipped") error.value = "Рассылка для этого абитуриента отключена.";
    else error.value = "Отправка не подтверждена. Проверьте исходящие письма перед повторной отправкой.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось отправить письмо.";
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <form class="grid gap-3 rounded-2xl border border-line bg-surface p-4" :class="{ 'mt-4': !bulk }"
    :aria-labelledby="bulk ? 'applicant-bulk-title' : 'applicant-mail-title'" @submit.prevent="send">
    <h4 :id="bulk ? 'applicant-bulk-title' : 'applicant-mail-title'" class="font-bold">{{ bulk ? "Письмо абитуриентам" : "Письмо абитуриенту" }}</h4>
    <p v-if="!bulk && recipients[0]" class="text-sm text-secondary [overflow-wrap:anywhere]">{{ recipients[0].name }} · {{ recipients[0].email }}</p>
    <fieldset class="grid min-w-0 gap-3" :disabled="sending || finished || !!batch">
      <label class="grid gap-1 text-sm">Шаблон
        <select v-model="template" :class="fieldClass" @change="applyTemplate">
          <option value="">Без шаблона</option>
          <option v-for="(draft, key) in applicantMailTemplates" :key="key" :value="key">{{ draft.name }}</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">Тема
        <input ref="subjectField" v-model="subject" :class="fieldClass" :maxlength="schoolMailSubjectLimit" required />
      </label>
      <label class="grid gap-1 text-sm">Текст письма
        <textarea v-model="text" :class="fieldClass" class="resize-y py-2" rows="5" :maxlength="schoolMailTextLimit" required />
      </label>
    </fieldset>
    <label v-if="!setupError" class="grid gap-1 text-sm">Код отправки писем
      <input v-model="accessCode" type="password" autocomplete="off" :class="fieldClass" :disabled="sending || finished" required />
    </label>
    <p v-if="bulk && sending && batch" role="status" class="text-sm text-secondary">Обработано {{ batch.handled }} из {{ batch.ids.length }}</p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <p v-if="status" role="status" class="text-sm text-accent">{{ status }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="submit" :disabled="sending || finished || !!setupError || !recipients.length"
        class="min-h-11 rounded-ui bg-accent px-4 text-sm font-bold text-white disabled:opacity-50">{{ setupError ? "Отправка недоступна" : sending ? "Отправляю…" : bulk && batch && !finished ? "Продолжить отправку" : bulk ? (allSelected ? "Отправить всем" : "Отправить выбранным") : "Отправить письмо" }}</button>
      <button v-if="!bulk || batch" type="button" :disabled="sending" class="min-h-11 rounded-ui border border-line px-4 text-sm font-bold text-accent"
        @click="emit('close')">{{ bulk ? "Новое письмо" : "Закрыть письмо" }}</button>
    </div>
  </form>
</template>
