<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { applicantUnsubscribeLabel, type SchoolApplicant } from "../../lib/olympiad";
import { schoolMailSubjectLimit, schoolMailTextLimit } from "../../lib/school-mail";
import { apiFetch } from "../session-api";

const props = defineProps<{ recipient: SchoolApplicant; setupError: string }>();
const emit = defineEmits<{ close: [] }>();
const subjectField = ref<HTMLInputElement>();
const subject = ref("");
const text = ref("");
const accessCode = ref("");
const sending = ref(false);
const finished = ref(false);
const status = ref("");
const error = ref("");
let requestId = crypto.randomUUID();
const fieldClass = "min-h-11 rounded-xl border border-line bg-canvas px-3 focus-visible:outline-accent";

onMounted(async () => {
  await nextTick();
  subjectField.value?.focus();
});

async function send(): Promise<void> {
  if (sending.value || finished.value || props.setupError) return;
  sending.value = true;
  error.value = "";
  try {
    const response = await apiFetch("/api/olympiad/applicant-mail", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, applicantId: props.recipient.id, subject: subject.value, text: text.value, accessCode: accessCode.value }),
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
  <form class="mt-4 grid gap-3 rounded-2xl border border-line p-4" aria-labelledby="applicant-mail-title" @submit.prevent="send">
    <h4 id="applicant-mail-title" class="font-bold">Письмо абитуриенту</h4>
    <p class="text-sm text-secondary [overflow-wrap:anywhere]">{{ recipient.name }} · {{ recipient.email }}</p>
    <fieldset class="grid min-w-0 gap-3" :disabled="sending || finished">
      <label class="grid gap-1 text-sm">Тема
        <input ref="subjectField" v-model="subject" :class="fieldClass" :maxlength="schoolMailSubjectLimit" required />
      </label>
      <label class="grid gap-1 text-sm">Текст письма
        <textarea v-model="text" :class="fieldClass" class="resize-y py-2" rows="5" :maxlength="schoolMailTextLimit" required />
      </label>
      <p class="text-sm text-secondary">В конце письма будет кнопка «{{ applicantUnsubscribeLabel }}».</p>
      <label v-if="!setupError" class="grid gap-1 text-sm">Код отправки писем
        <input v-model="accessCode" type="password" autocomplete="off" :class="fieldClass" required />
      </label>
    </fieldset>
    <p v-if="setupError" class="text-sm text-secondary">{{ setupError }}</p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <p v-if="status" role="status" class="text-sm text-accent">{{ status }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="submit" :disabled="sending || finished || !!setupError"
        class="min-h-11 rounded-ui bg-accent px-4 text-sm font-bold text-white disabled:opacity-50">{{ sending ? "Отправляю…" : "Отправить письмо" }}</button>
      <button type="button" :disabled="sending" class="min-h-11 rounded-ui border border-line px-4 text-sm font-bold text-accent"
        @click="emit('close')">Закрыть письмо</button>
    </div>
  </form>
</template>
