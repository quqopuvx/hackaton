<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { institutionTypeLabels } from "../../lib/institution-types";
import type { SchoolApplicant } from "../../lib/olympiad";
import type { Institution } from "../../lib/types";
import { apiFetch } from "../session-api";
import ApplicantMailForm from "./ApplicantMailForm.vue";

const props = defineProps<{ institution: Institution }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const applicants = ref<SchoolApplicant[]>([]);
const loading = ref(true);
const error = ref("");
const mailSetupError = ref("");
const recipient = ref<SchoolApplicant>();
const request = new AbortController();

async function loadApplicants(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await apiFetch(`/api/institutions/${props.institution.id}/applicants`, { signal: request.signal });
    if (!response.ok) throw new Error();
    const data: { applicants: SchoolApplicant[]; mailSetupError?: string } = await response.json();
    applicants.value = data.applicants;
    mailSetupError.value = data.mailSetupError ?? "";
  } catch {
    if (!request.signal.aborted) error.value = "Не удалось загрузить список абитуриентов.";
  } finally {
    loading.value = false;
  }
}

function close(): void {
  dialog.value?.close();
  emit("close");
}

onMounted(() => {
  dialog.value?.showModal();
  void loadApplicants();
});
onBeforeUnmount(() => {
  request.abort();
  dialog.value?.close();
});
</script>

<template>
  <dialog ref="dialog" aria-labelledby="institution-details-title" @cancel.prevent="close"
    class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-ui border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-slate-900/45 sm:p-7">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <h2 id="institution-details-title" class="min-w-0 flex-1 text-xl font-bold [overflow-wrap:anywhere]">{{ institution.name }}</h2>
      <button type="button" autofocus class="min-h-11 rounded-ui border border-line px-4 text-sm font-bold text-accent hover:bg-accent-soft focus-visible:outline-accent"
        @click="close">Закрыть</button>
    </div>
    <dl class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [overflow-wrap:anywhere]">
      <dt class="text-secondary">Тип</dt><dd>{{ institution.institutionType ? institutionTypeLabels[institution.institutionType] : "Не указан" }}</dd>
      <dt class="text-secondary">Город</dt><dd>{{ institution.city }}</dd>
      <dt class="text-secondary">Регион</dt><dd>{{ institution.region }}</dd>
      <template v-if="institution.leaderName"><dt class="text-secondary">Руководитель</dt><dd>{{ institution.leaderName }}</dd></template>
      <template v-if="institution.institutionEmail"><dt class="text-secondary">Почта</dt><dd>{{ institution.institutionEmail }}</dd></template>
      <template v-if="institution.institutionPhone"><dt class="text-secondary">Телефон</dt><dd>{{ institution.institutionPhone }}</dd></template>
    </dl>
    <section v-if="institution.institutionType === 'school' || loading || error || applicants.length"
      aria-labelledby="institution-applicants-title" class="mt-6 border-t border-line pt-4">
      <h3 id="institution-applicants-title" class="text-lg font-bold">Абитуриенты</h3>
      <p v-if="loading" role="status" class="mt-2 text-sm text-secondary">Загружаю список…</p>
      <div v-else-if="error" class="mt-2 text-sm">
        <p role="alert" class="text-danger">{{ error }}</p>
        <button type="button" class="min-h-11 font-bold text-accent underline focus-visible:outline-accent" @click="loadApplicants">
          Повторить загрузку
        </button>
      </div>
      <p v-else-if="!applicants.length" class="mt-2 text-sm text-secondary">Из этой школы пока никто не зарегистрировался.</p>
      <ul v-else class="mt-2 divide-y divide-line">
        <li v-for="applicant in applicants" :key="applicant.id" class="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm [overflow-wrap:anywhere]">
          <div>
            <p class="font-bold">{{ applicant.name }}</p>
            <p class="text-secondary">{{ applicant.email }}</p>
          </div>
          <div class="grid justify-items-start gap-1 sm:justify-items-end">
            <p class="text-secondary">{{ applicant.invitationOptIn ? "Согласен на приглашения" : "Рассылка отключена" }}</p>
            <button v-if="applicant.invitationOptIn" type="button"
              class="min-h-11 rounded-ui border border-line px-4 font-bold text-accent hover:bg-accent-soft focus-visible:outline-accent"
              :aria-label="`Написать письмо: ${applicant.name}`" @click="recipient = applicant">Написать письмо</button>
          </div>
        </li>
      </ul>
      <ApplicantMailForm v-if="recipient" :key="recipient.id" :recipient="recipient" :setup-error="mailSetupError"
        @close="recipient = undefined" />
    </section>
  </dialog>
</template>
