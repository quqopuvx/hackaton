<script setup lang="ts">
import { apiFetch } from "../session-api";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import type { CampaignMailPreset } from "../../lib/campaigns";
import { isSingleEmail, schoolMailDefaultLayout, schoolMailDraft, schoolMailLayouts, schoolMailLimit, schoolMailSubjectLimit, schoolMailTemplates, schoolMailTextLimit, schoolNameToken } from "../../lib/school-mail";
import type { SavedSchoolMailTemplate, SchoolMailLayout, SchoolMailOutcome, SchoolMailTemplate } from "../../lib/school-mail";
import type { Institution } from "../../lib/types";
import SchoolMailPreview from "./SchoolMailPreview.vue";
import SchoolMailTemplates from "./SchoolMailTemplates.vue";
import { mailDesignText, type SchoolMailDesign } from "../../lib/school-mail-design";
import { fetchMailTemplate } from "../school-mail-template-api";

const props = defineProps<{
  recipients: Institution[]; savedTemplates: SavedSchoolMailTemplate[]; reminderPreset: boolean; campaignMail?: CampaignMailPreset;
  defaultTemplate: string; signature: string; replyTo: string; active: boolean;
}>();
const emit = defineEmits<{
  lock: []; unlock: []; reset: []; sent: [];
  delivery: [requestId: string, outcomes: SchoolMailOutcome[]]; deliveryError: [requestId: string, message: string]; returnToRecipients: []; templateSaved: [template: SavedSchoolMailTemplate];
}>();
const template = ref(props.campaignMail ? "invitation" : props.reminderPreset ? "reminder" : "");
const draft = ref("");
const createTemplateOption = "__create_template__";
const createTemplateDialog = ref<HTMLDialogElement>();
const templateCreator = ref<InstanceType<typeof SchoolMailTemplates>>();
const creatingTemplate = ref(false);

function closeTemplateCreator(): void {
  if (templateCreator.value?.blocked) return;
  createTemplateDialog.value?.close();
  creatingTemplate.value = false;
}

watch(() => props.active, (active) => {
  if (active) return;
  if (templateCreator.value?.blocked) createTemplateDialog.value?.close();
  else closeTemplateCreator();
});

async function changeTemplate(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  if (select.value !== createTemplateOption) {
    template.value = select.value;
    return;
  }
  select.value = template.value;
  if (snapshot.value || createTemplateDialog.value?.open) return;
  creatingTemplate.value = true;
  await nextTick();
  if (props.active) createTemplateDialog.value?.showModal();
}

async function applyNewTemplate(saved: SavedSchoolMailTemplate): Promise<void> {
  emit("templateSaved", saved);
  createTemplateDialog.value?.close();
  creatingTemplate.value = false;
  await nextTick();
  template.value = saved.id;
}
const selectedTemplate = computed(() => {
  if (Object.hasOwn(schoolMailTemplates, template.value)) {
    const key = template.value as SchoolMailTemplate;
    return { subject: schoolMailTemplates[key], text: schoolMailDraft(key), layout: schoolMailDefaultLayout(key) };
  }
  return props.savedTemplates.find(({ id }) => id === template.value);
});
const subject = ref("");
const layout = ref<SchoolMailLayout>("plain");
const design = ref<SchoolMailDesign | null>(null);
const loadingDesign = ref(false);
const designError = ref("");
let designRequest: AbortController | undefined;
onUnmounted(() => designRequest?.abort());

async function restoreTemplate(): Promise<void> {
  designRequest?.abort();
  const selected = selectedTemplate.value;
  draft.value = selected?.text ?? "";
  subject.value = selected?.subject ?? "";
  layout.value = selected?.layout ?? "plain";
  design.value = selected && "design" in selected ? selected.design ?? null : null;
  designError.value = "";
  loadingDesign.value = false;
  if (design.value || !selected || !("hasDesign" in selected) || !selected.hasDesign) return;

  const controller = new AbortController();
  designRequest = controller;
  loadingDesign.value = true;
  try {
    const full = await fetchMailTemplate(selected.id, controller.signal);
    if (controller.signal.aborted) return;
    draft.value = full.text;
    subject.value = full.subject;
    layout.value = full.layout;
    design.value = full.design ?? null;
  } catch (cause) {
    if (!controller.signal.aborted) designError.value = cause instanceof Error ? cause.message : "Не удалось загрузить оформление.";
  } finally {
    if (!controller.signal.aborted) loadingDesign.value = false;
  }
}
watch(template, restoreTemplate, { immediate: true });
watch(() => {
  const preferred = props.defaultTemplate;
  return Object.hasOwn(schoolMailTemplates, preferred) || props.savedTemplates.some(({ id }) => id === preferred) ? preferred : "";
}, (preferred) => {
  if (!template.value && preferred) template.value = preferred;
}, { immediate: true });
if (props.campaignMail) {
  subject.value = props.campaignMail.draft.subject;
  draft.value = props.campaignMail.draft.text;
}
const accessCode = ref("");
const previewId = ref("");
const busy = ref(false);
const error = ref("");
const outcomes = ref<SchoolMailOutcome[]>();
const snapshot = ref<{
  requestId: string; template: string; recipients: Institution[]; text: string; subject: string; layout: SchoolMailLayout; campaignId?: string; replyTo?: string;
  design: SchoolMailDesign | null; signature?: string;
}>();
watch(() => props.savedTemplates, (current, previous) => {
  if (snapshot.value || !previous.some(({ id }) => id === template.value) ||
      current.some(({ id }) => id === template.value)) return;
  template.value = "";
  error.value = "Выбранный шаблон удалён. Выберите другой.";
});
const recipients = computed(() => snapshot.value?.recipients ?? props.recipients);
const messageText = computed(() => [draft.value.trim(), props.signature.trim()].filter(Boolean).join("\n\n"));
const overLimit = computed(() => (design.value ? mailDesignText(design.value, draft.value, props.signature) : messageText.value).length > schoolMailTextLimit);
const replyAddress = computed(() => snapshot.value ? snapshot.value.replyTo : props.replyTo);
const previewRecipient = computed(() => recipients.value.find((recipient) => recipient.id === previewId.value) ?? recipients.value[0]);
const preview = computed(() => !loadingDesign.value && !designError.value && subject.value.trim() && previewRecipient.value ? {
  subject: snapshot.value?.subject ?? subject.value.trim(),
  text: snapshot.value?.text ?? (design.value ? draft.value : messageText.value),
  layout: snapshot.value?.layout ?? layout.value,
  schoolName: previewRecipient.value.name,
  design: snapshot.value ? snapshot.value.design : design.value,
  signature: snapshot.value ? snapshot.value.signature : props.signature,
} : undefined);
const valid = computed(() => recipients.value.every((recipient) =>
  (!props.campaignMail || recipient.institutionType === "school") &&
  isSingleEmail(recipient.institutionEmail?.trim() ?? "")));
const canSubmit = computed(() => recipients.value.length > 0 && template.value && subject.value.trim() && draft.value.trim() && !loadingDesign.value && !designError.value &&
  (snapshot.value || !overLimit.value) &&
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
const controlClass = "min-h-11 w-full rounded-ui border border-line bg-canvas px-3 text-sm text-ink";

async function send(): Promise<void> {
  if (!canSubmit.value || !template.value) return;
  busy.value = true;
  error.value = "";
  const retrying = !!snapshot.value;
  try {
    const request = snapshot.value ??= {
      requestId: crypto.randomUUID(), template: template.value, recipients: [...props.recipients],
      text: design.value ? draft.value.trim() : messageText.value, subject: subject.value.trim(),
      layout: layout.value, design: design.value, signature: design.value ? props.signature : undefined,
      campaignId: props.campaignMail?.campaignId,
      replyTo: props.replyTo || undefined,
    };
    emit("lock");
    const response = await apiFetch("/api/school-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: request.requestId, template: request.template, accessCode: accessCode.value, text: request.text, subject: request.subject,
        layout: request.layout, campaignId: request.campaignId, replyTo: request.replyTo,
        design: request.design, signature: request.signature,
        recipients: request.recipients.map((recipient) => ({ id: recipient.id, email: recipient.institutionEmail?.trim() })),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      error.value = result.error ?? "Не удалось запросить отправку.";
      emit("deliveryError", request.requestId, error.value);
      if (response.status === 403) {
        accessCode.value = "";
        // A first attempt rejected by authorization never reached mail delivery.
        if (!retrying) {
          snapshot.value = undefined;
          emit("unlock");
        }
      }
      return;
    }
    outcomes.value = result.outcomes;
    if (outcomes.value) emit("delivery", request.requestId, outcomes.value);
    if (!outcomes.value?.some((outcome) => outcome.status === "sending")) accessCode.value = "";
    emit("sent");
  } catch {
    error.value = "Не удалось получить результат. Повторите проверку этой отправки, чтобы избежать дублей.";
    if (snapshot.value) emit("deliveryError", snapshot.value.requestId, error.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section id="school-mail" class="min-w-0 rounded-ui border border-line bg-surface p-4 sm:p-5" aria-labelledby="school-mail-title">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 id="school-mail-title" tabindex="-1" class="text-lg font-semibold">Подготовить письмо</h3>
      <div class="flex flex-wrap gap-x-4">
        <button v-if="!snapshot && !campaignMail" type="button" class="min-h-11 text-sm font-semibold text-accent"
          @click="emit('returnToRecipients')">Вернуться к списку</button>
        <button type="button" class="min-h-11 text-sm font-medium text-accent disabled:opacity-50"
          :disabled="busy" @click="emit('reset')">{{ outcomes ? "Новая рассылка" : "Сбросить черновик и выбор" }}</button>
      </div>
    </div>
    <p class="text-sm text-secondary">Выбрано получателей: {{ recipients.length }} из {{ schoolMailLimit }}</p>
    <p v-if="!recipients.length" class="mt-2 text-sm text-secondary">Добавьте получателей, чтобы увидеть предпросмотр и отправить письмо.</p>
    <ul v-else class="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm [overflow-wrap:anywhere]">
      <li v-for="recipient in recipients" :key="recipient.id">
        {{ recipient.name }} · <span class="text-secondary">{{ recipient.institutionEmail || "Нет адреса" }}</span>
        <span v-if="outcomeById.has(recipient.id)" class="block text-xs"
          :class="outcomeById.get(recipient.id)?.status === 'sent' ? 'text-accent' : 'text-secondary'">
          {{ outcomeById.get(recipient.id)?.message || resultLabels[outcomeById.get(recipient.id)!.status] }}
        </span>
      </li>
    </ul>
    <form class="mt-4 space-y-4" @submit.prevent="send">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1 text-sm font-medium">
          Шаблон письма
          <select :value="template" :class="controlClass" :disabled="!!snapshot" @change="changeTemplate">
            <option value="" disabled>Выберите шаблон</option>
            <option v-for="(label, key) in schoolMailTemplates" :key="key" :value="key">{{ label }}</option>
            <optgroup v-if="savedTemplates.length" label="Сохранённые шаблоны">
              <option v-for="saved in savedTemplates" :key="saved.id" :value="saved.id">{{ saved.name }}</option>
            </optgroup>
            <option :value="createTemplateOption" class="create-template-option">Создать новый шаблон</option>
          </select>
        </label>
        <label v-if="preview && recipients.length > 1" class="grid gap-1 text-sm font-medium">
          Получатель для предпросмотра
          <select :value="previewRecipient?.id" :class="controlClass" @change="previewId = ($event.target as HTMLSelectElement).value">
            <option v-for="recipient in recipients" :key="recipient.id" :value="recipient.id">{{ recipient.name }}</option>
          </select>
        </label>
      </div>
      <fieldset v-if="template && !snapshot" :disabled="loadingDesign" class="grid min-w-0 gap-2">
        <p v-if="loadingDesign" class="text-sm text-secondary" role="status">Загружаю оформление…</p>
        <p v-if="designError" class="text-sm text-danger" role="alert">{{ designError }}</p>
        <label class="grid gap-1 text-sm font-medium">
          Тема письма
          <input v-model="subject" :maxlength="schoolMailSubjectLimit" :class="controlClass" required />
        </label>
        <p v-if="design" class="text-sm text-secondary">Оформление из конструктора. Блоки, изображения и фон можно изменить в разделе «Шаблоны».</p>
        <label v-else class="grid gap-1 text-sm font-medium">
          Оформление письма
          <select v-model="layout" :class="controlClass">
            <option v-for="(label, key) in schoolMailLayouts" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label for="school-mail-text" class="text-sm font-medium">{{ design ? "Основной текст письма" : "Текст письма" }}</label>
        <textarea id="school-mail-text" v-model="draft" rows="7" :maxlength="schoolMailTextLimit" required
          aria-describedby="school-mail-personalization" :class="controlClass" class="resize-y py-3" />
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-secondary">
          <p id="school-mail-personalization">Вместо <code>{{ schoolNameToken }}</code> подставится название учреждения.</p>
          <button type="button" class="min-h-11 font-medium text-accent" @click="restoreTemplate">
            Восстановить шаблон
          </button>
        </div>
      </fieldset>
      <SchoolMailPreview v-if="preview" v-bind="preview" />
      <p v-if="replyAddress" class="text-sm text-secondary">Адрес для ответов — {{ replyAddress }}</p>
      <p v-if="!snapshot && overLimit" role="alert" class="text-sm text-danger">
        Сократите письмо до {{ schoolMailTextLimit }} символов вместе с подписью.
      </p>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <p v-if="!valid" role="alert" class="text-sm text-danger">Проверьте адреса и данные выбранных получателей.</p>
      <p v-if="outcomes" role="status" class="text-sm font-medium">Почтовый сервер принял {{ acceptedCount }} из {{ recipients.length }} писем.</p>
      <div v-if="preview && (!outcomes || outcomes.some((outcome) => outcome.status === 'sending'))"
        class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1 text-sm font-medium">
          Код доступа к отправке
          <input v-model="accessCode" :class="controlClass" type="password" autocomplete="off" :disabled="busy" required />
        </label>
        <button type="submit" :disabled="!canSubmit"
          class="min-h-11 rounded-ui bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
          {{ busy ? "Отправка…" : snapshot ? "Повторить запрос отправки" : "Подтвердить и отправить" }}
        </button>
      </div>
    </form>
    <dialog ref="createTemplateDialog" aria-labelledby="create-template-title"
      class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto
        rounded-ui border border-line bg-surface p-4 text-ink shadow-xl backdrop:bg-slate-900/45 sm:p-6"
      @cancel.prevent="closeTemplateCreator">
      <h2 id="create-template-title" class="mb-4 text-xl font-extrabold text-accent">Создать новый шаблон</h2>
      <SchoolMailTemplates v-if="creatingTemplate" ref="templateCreator" create-only
        @cancel="closeTemplateCreator" @saved="applyNewTemplate" />
    </dialog>
  </section>
</template>
