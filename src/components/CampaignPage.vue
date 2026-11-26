<script setup lang="ts">
import { apiFetch } from "../session-api";
import { computed, nextTick, ref, watch } from "vue";
import { campaignMessageLimit, hasUpperGrades, type CampaignDetails, type CampaignMailPreset, type CampaignSummary, type CampaignView } from "../../lib/campaigns";
import { isSingleEmail, personalizeSchoolMail, schoolMailLimit } from "../../lib/school-mail";
import type { Institution } from "../../lib/types";

const props = defineProps<{ active: boolean; mailLocked: boolean }>();
const emit = defineEmits<{ prepareMail: [preset: CampaignMailPreset] }>();
const campaigns = ref<CampaignSummary[]>([]);
const campaign = ref<CampaignView>();
const selected = ref(new Set<string>());
const title = ref("");
const details = ref<CampaignDetails>({ title: "", schedule: "", registrationUrl: "" });
const input = ref("");
const transcript = ref<HTMLElement>();
const chatInput = ref<HTMLTextAreaElement>();
const schoolList = ref<HTMLElement>();
const pendingMessage = ref("");
const highlightedSchool = ref("");
const campaignDialog = ref<HTMLDialogElement>();
const formMode = ref<"create" | "details">();
const dialogClass = "fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-ui border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-slate-900/45 sm:p-7";
const deleteDialog = ref<HTMLDialogElement>();
const deleteError = ref("");
const pending = ref<"load" | "create" | "details" | "chat" | "delete" | "">("");
const error = ref("");
const canRefresh = ref(false);
const field = "min-h-11 w-full rounded-ui border border-line bg-canvas px-3 text-sm text-ink focus-visible:outline-accent";
const primary = "min-h-11 rounded-ui bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50";
const secondary = "min-h-11 rounded-ui border border-line px-3 text-sm font-semibold text-accent disabled:opacity-50";
const prompts = [
  { label: "Подобрать школы", text: "Подбери школы " },
  { label: "Добавить школу", text: "Добавь в подборку школу " },
  { label: "Подготовить письмо", text: "Подготовь приглашение для школ из подборки." },
];

const deliveryLabels = {
  sent: "Принято почтовым сервером", sending: "Отправляется",
  failed: "Ошибка отправки", uncertain: "Проверьте результат в почте", skipped: "Пропущено",
};
const statuses = computed(() => new Map(campaign.value?.deliveries.map(({ id, status }) => [id, status])));
const sentCount = computed(() => campaign.value?.deliveries.filter(({ status }) => status === "sent").length ?? 0);
const eligible = computed(() => new Set(campaign.value?.schools.filter((school) => {
  const status = statuses.value.get(school.id);
  return isSingleEmail(school.institutionEmail?.trim() ?? "") && (!status || status === "failed");
}).map(({ id }) => id)));
const recipients = computed(() => [...selected.value].filter((id) => eligible.value.has(id)));
const dirty = computed(() => !!campaign.value && (
  details.value.title !== campaign.value.title || details.value.schedule !== campaign.value.schedule ||
  details.value.registrationUrl !== campaign.value.registrationUrl
));
const sample = computed(() => {
  const draft = campaign.value?.state.draft;
  const school = campaign.value?.schools.find(({ id }) => selected.value.has(id));
  return draft && school ? personalizeSchoolMail(draft.text, school.name) : draft?.text;
});

async function api<T>(path = "", method = "GET", body?: object): Promise<T> {
  const response = await apiFetch(`/api/campaigns${path}`, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    canRefresh.value = response.status === 409;
    throw new Error(result.error ?? "Не удалось выполнить запрос.");
  }
  return result as T;
}

function show(next: CampaignView): void {
  const previous = campaign.value;
  const switched = previous?.id !== next.id;
  const changed = switched || previous.state.upperGrades !== next.state.upperGrades ||
    previous.state.schoolIds.join() !== next.state.schoolIds.join();
  const added = next.state.lastAddedSchoolId;
  const appended = !!added && !switched && !previous.state.schoolIds.includes(added) &&
    previous.state.schoolIds.every((id, index) => id === next.state.schoolIds[index]);
  campaign.value = next;
  if (switched || previous.version !== next.version) restoreDetails();
  selected.value = new Set(changed && !appended
    ? next.schools.filter((school) => eligible.value.has(school.id) && (!next.state.upperGrades || hasUpperGrades(school)))
      .slice(0, schoolMailLimit).map(({ id }) => id)
    : recipients.value);
  if (changed) highlightedSchool.value = appended ? added : "";
  if (appended && selected.value.size < schoolMailLimit && eligible.value.has(added)) selected.value.add(added);
  scrollChat();
  if (appended) void nextTick(() => { if (schoolList.value) schoolList.value.scrollTop = schoolList.value.scrollHeight; });
}

function scrollChat(): void {
  void nextTick(() => {
    if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight;
  });
}

async function perform(kind: Exclude<typeof pending.value, "">, action: () => Promise<void>): Promise<void> {
  if (pending.value) return;
  pending.value = kind;
  error.value = "";
  canRefresh.value = false;
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось открыть кампанию.";
  } finally {
    pending.value = "";
  }
}

function reload(): Promise<void> {
  return perform("load", async () => {
    campaigns.value = (await api<{ campaigns: CampaignSummary[] }>()).campaigns;
    const currentId = campaign.value?.id;
    if (currentId && !campaigns.value.some(({ id }) => id === currentId)) {
      campaign.value = undefined;
      input.value = "";
      if (formMode.value === "details") closeCampaignForm();
    }
    const id = campaign.value?.id ?? campaigns.value[0]?.id;
    if (id) show(await api<CampaignView>(`/${id}`));
  });
}

watch(() => props.active, (active) => {
  if (active) void reload();
  else {
    deleteDialog.value?.close();
    closeCampaignForm();
  }
}, { immediate: true });

function open(id: string): void {
  if (!id || id === campaign.value?.id) return;
  void perform("load", async () => {
    show(await api<CampaignView>(`/${id}`));
    input.value = "";
  });
}

function restoreDetails(): void {
  const current = campaign.value;
  if (current) details.value = { title: current.title, schedule: current.schedule, registrationUrl: current.registrationUrl };
}

async function openCampaignForm(mode: "create" | "details"): Promise<void> {
  if (pending.value || formMode.value || (mode === "details" && !campaign.value)) return;
  error.value = "";
  canRefresh.value = false;
  formMode.value = mode;
  await nextTick();
  if (props.active && formMode.value === mode) campaignDialog.value?.showModal();
}

function closeCampaignForm(): void {
  if (!formMode.value) return;
  campaignDialog.value?.close();
  formMode.value = undefined;
  title.value = "";
  restoreDetails();
}

function cancelCampaignForm(): void {
  if (pending.value) return;
  closeCampaignForm();
  error.value = "";
  canRefresh.value = false;
}

function create(): void {
  if (!title.value.trim()) return;
  void perform("create", async () => {
    const next = await api<CampaignView>("", "POST", { title: title.value.trim() });
    campaigns.value.unshift({ id: next.id, title: next.title });
    input.value = "";
    closeCampaignForm();
    show(next);
  });
}

function confirmDelete(): void {
  if (!campaign.value || pending.value || props.mailLocked) return;
  deleteError.value = "";
  deleteDialog.value?.showModal();
}

function closeDelete(): void {
  if (pending.value !== "delete") deleteDialog.value?.close();
}

async function removeCampaign(): Promise<void> {
  const current = campaign.value;
  if (!current || !deleteDialog.value?.open || pending.value || props.mailLocked) return;
  deleteError.value = "";
  await perform("delete", async () => {
    try {
      await api<{ deleted: true }>("/" + current.id, "DELETE", { version: current.version });
    } catch (cause) {
      deleteError.value = cause instanceof Error ? cause.message : "Не удалось удалить кампанию.";
      return;
    }
    deleteDialog.value?.close();
    closeCampaignForm();
    campaigns.value = campaigns.value.filter(({ id }) => id !== current.id);
    campaign.value = undefined;
    input.value = "";
    const next = campaigns.value[0];
    if (next) show(await api<CampaignView>("/" + next.id));
  });
}

function saveDetails(): void {
  const current = campaign.value;
  if (!current || !dirty.value) return;
  void perform("details", async () => {
    const next = await api<CampaignView>(`/${current.id}`, "PATCH", {
      version: current.version, ...details.value, registrationUrl: details.value.registrationUrl.trim(),
    });
    show(next);
    closeCampaignForm();
    const item = campaigns.value.find(({ id }) => id === next.id);
    if (item) item.title = next.title;
  });
}

function sendMessage(): void {
  const current = campaign.value;
  const message = input.value.trim();
  if (!current || !message || dirty.value || pending.value) return;
  void submitChat(current, { message }, message, true);
}

function chooseSchool(school: Institution): void {
  const current = campaign.value;
  if (!current || dirty.value || pending.value) return;
  void submitChat(current, { schoolId: school.id }, `Выбираю «${school.name}» (${school.city}).`);
}

async function submitChat(current: CampaignView, body: { message: string } | { schoolId: string },
  message: string, clearInput = false): Promise<void> {
  pendingMessage.value = message;
  scrollChat();
  await perform("chat", async () => {
    const next = await api<CampaignView>(`/${current.id}`, "POST", { version: current.version, ...body });
    if (clearInput) input.value = "";
    show(next);
  });
  pendingMessage.value = "";
  scrollChat();
  await nextTick();
  chatInput.value?.focus();
}

function usePrompt(text: string): void {
  if (!input.value.trim()) input.value = text;
  chatInput.value?.focus();
}

function chatKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendMessage();
}

function toggle(id: string): void {
  if (selected.value.has(id)) selected.value.delete(id);
  else if (eligible.value.has(id) && recipients.value.length < schoolMailLimit) selected.value.add(id);
}

function prepareMail(): void {
  const current = campaign.value;
  if (current?.state.draft && recipients.value.length && !props.mailLocked && !dirty.value) {
    emit("prepareMail", { campaignId: current.id, recipientIds: recipients.value, draft: current.state.draft });
  }
}
</script>

<template>
  <section aria-labelledby="campaigns-title" class="min-h-0 w-full flex-1 overflow-y-auto pt-4 pb-5 sm:pt-5">
    <header class="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
      <h2 id="campaigns-title" class="mr-1 text-xl font-extrabold text-accent sm:text-2xl">Кампании</h2>
      <select v-if="campaigns.length" aria-label="Текущая кампания" :value="campaign?.id ?? ''" :disabled="!!pending"
        :class="field" class="!w-auto min-w-0 max-w-full sm:max-w-sm"
        @change="open(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>Выберите кампанию</option>
        <option v-for="item in campaigns" :key="item.id" :value="item.id">{{ item.title }}</option>
      </select>
      <div class="flex flex-wrap gap-2 sm:ml-auto">
        <button v-if="campaign" type="button" :class="secondary" aria-haspopup="dialog" aria-controls="campaign-form"
          :disabled="!!pending" @click="openCampaignForm('details')">Данные мероприятия</button>
        <button type="button" :class="secondary" aria-haspopup="dialog" aria-controls="campaign-form"
          :disabled="!!pending" @click="openCampaignForm('create')">Новая кампания</button>
        <button type="button" :class="secondary" :disabled="!!pending" @click="reload">Обновить</button>
      </div>
    </header>
    <dialog id="campaign-form" ref="campaignDialog" :class="dialogClass" aria-labelledby="campaign-form-title"
      @cancel.prevent="cancelCampaignForm">
      <h3 id="campaign-form-title" class="text-lg font-bold">
        {{ formMode === "create" ? "Новая кампания" : "Данные мероприятия" }}
      </h3>
      <form class="mt-4 grid gap-3" @submit.prevent="formMode === 'create' ? create() : saveDetails()">
        <label v-if="formMode === 'create'" class="grid gap-1 text-sm font-semibold">
          Название новой кампании
          <input v-model="title" :class="field" maxlength="120" placeholder="День открытых дверей"
            :disabled="!!pending" required autofocus />
        </label>
        <template v-else>
          <label class="grid gap-1 text-sm font-medium">
            Название мероприятия
            <input v-model="details.title" :class="field" maxlength="120" :disabled="!!pending" required autofocus />
          </label>
          <label class="grid gap-1 text-sm font-medium">
            Дата, время и часовой пояс
            <input v-model="details.schedule" :class="field" maxlength="160" :disabled="!!pending"
              placeholder="12 декабря, 14:00 по Якутску" />
          </label>
          <label class="grid gap-1 text-sm font-medium">
            Ссылка на регистрацию
            <input v-model="details.registrationUrl" :class="field" type="url" maxlength="1000" :disabled="!!pending" />
          </label>
        </template>
        <p v-if="error" role="alert" class="text-sm text-danger">
          {{ error }}
          <button v-if="canRefresh" type="button" class="ml-2 min-h-11 font-semibold underline" @click="reload">Обновить кампанию</button>
        </p>
        <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
          <button v-if="formMode === 'details'" type="button"
            class="mr-auto min-h-11 rounded-ui border border-line px-3 text-sm font-semibold text-danger disabled:opacity-50"
            :disabled="!!pending || mailLocked" @click="confirmDelete">Удалить кампанию</button>
          <button type="button" :class="secondary" :disabled="!!pending" @click="cancelCampaignForm">Отмена</button>
          <button type="submit" :class="primary" :disabled="!!pending || (formMode === 'create' ? !title.trim() : !dirty)">
            {{ formMode === "create" ? "Создать кампанию" : "Сохранить данные" }}
          </button>
        </div>
      </form>
    </dialog>
    <dialog ref="deleteDialog" aria-labelledby="delete-campaign-title" aria-describedby="delete-campaign-description"
      :class="dialogClass"
      @cancel.prevent="closeDelete">
      <h3 id="delete-campaign-title" class="text-lg font-semibold">Удалить кампанию?</h3>
      <p id="delete-campaign-description" class="mt-2 text-sm text-secondary [overflow-wrap:anywhere]">
        Кампания «{{ campaign?.title }}» будет удалена без возможности восстановления.
      </p>
      <p v-if="deleteError" role="alert" class="mt-3 text-sm text-danger">{{ deleteError }}</p>
      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" :class="secondary" :disabled="pending === 'delete'" autofocus @click="closeDelete">Отмена</button>
        <button type="button" class="min-h-11 rounded-ui border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50"
          :disabled="!!pending || mailLocked" @click="removeCampaign">
          {{ pending === "delete" ? "Удаляю…" : "Удалить кампанию" }}
        </button>
      </div>
    </dialog>
    <div class="grid min-w-0 gap-4">
        <p v-if="error && !formMode" role="alert" class="text-sm text-danger">
          {{ error }}
          <button v-if="canRefresh" type="button" class="ml-2 min-h-11 font-semibold underline" @click="reload">Обновить кампанию</button>
        </p>
        <p v-if="!campaign" role="status" class="rounded-ui border border-line bg-surface p-4 text-sm text-secondary">
          {{ pending === "load" ? "Загружаю кампании…" : "Создайте кампанию, чтобы подобрать школы и подготовить приглашение." }}
        </p>
        <template v-else>
          <div class="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(16rem,1fr)]">
            <section class="flex h-[clamp(32rem,72dvh,52rem)] min-w-0 flex-col overflow-hidden rounded-ui border border-line bg-surface"
              aria-labelledby="campaign-chat-title">
              <header class="border-b border-line px-4 py-3 sm:px-5">
                <h3 id="campaign-chat-title" class="text-lg font-semibold">Чат с агентом</h3>
              </header>
              <div ref="transcript" role="log" aria-label="История чата"
                class="min-h-0 flex-1 space-y-5 overflow-y-auto bg-canvas/50 px-4 py-5 [scrollbar-gutter:stable] sm:px-5">
                <div v-if="!campaign.state.messages.length && !pendingMessage"
                  class="max-w-sm rounded-ui border border-line bg-surface p-4 text-sm">
                  <p class="font-semibold">Кого пригласим?</p>
                  <p class="mt-1 text-secondary">Попросите подобрать школы по городу или добавить конкретную школу по названию и номеру.</p>
                </div>
                <div v-for="(message, index) in campaign.state.messages" :key="index"
                  class="w-fit max-w-[90%] rounded-ui px-4 py-3.5 text-sm [overflow-wrap:anywhere] sm:max-w-[82%]"
                  :class="message.role === 'user' ? 'ml-auto bg-accent-soft' : 'border border-line bg-surface'">
                  <p class="mb-1.5 text-xs font-semibold text-accent">{{ message.role === "user" ? "Вы" : "Агент" }}</p>
                  <p class="whitespace-pre-wrap leading-6">{{ message.text }}</p>
                </div>
                <div v-if="campaign.schoolChoices.length && !pendingMessage" class="grid max-w-lg gap-1">
                  <button v-for="school in campaign.schoolChoices" :key="school.id" type="button"
                    :disabled="!!pending || dirty"
                    class="min-h-11 rounded-ui border border-line bg-surface px-3 py-2 text-left text-sm hover:border-accent disabled:opacity-50"
                    @click="chooseSchool(school)">
                    <span class="block font-semibold text-accent">{{ school.name }}</span>
                    <span class="block text-xs text-secondary">{{ school.city }} · {{ school.region }}</span>
                  </button>
                </div>
                <template v-if="pendingMessage">
                  <div class="ml-auto w-fit max-w-[90%] rounded-ui bg-accent-soft px-4 py-3.5 text-sm [overflow-wrap:anywhere] sm:max-w-[82%]">
                    <p class="mb-1.5 text-xs font-semibold text-accent">Вы</p>
                    <p class="whitespace-pre-wrap leading-6">{{ pendingMessage }}</p>
                  </div>
                  <p role="status" class="w-fit rounded-ui border border-line bg-surface px-3 py-2 text-sm text-secondary">
                    Агент обрабатывает запрос…
                  </p>
                </template>
              </div>
              <form class="grid shrink-0 gap-3 border-t border-line bg-surface p-3 sm:p-4" @submit.prevent="sendMessage">
                <div class="flex flex-wrap gap-2" aria-label="Быстрые команды">
                  <button v-for="prompt in prompts" :key="prompt.label" type="button"
                    class="min-h-9 rounded-ui border border-line px-2.5 text-xs font-semibold text-accent hover:border-accent disabled:opacity-50"
                    :disabled="!!pending" @click="usePrompt(prompt.text)">{{ prompt.label }}</button>
                </div>
                <label for="campaign-chat-input" class="sr-only">Сообщение агенту</label>
                <div class="rounded-ui border border-line bg-canvas px-3 pb-2.5 pt-3 focus-within:border-accent sm:px-4">
                  <textarea id="campaign-chat-input" ref="chatInput" v-model="input" rows="3"
                    :maxlength="campaignMessageLimit" :disabled="!!pending"
                    class="block w-full min-w-0 resize-none bg-transparent px-1 pt-3 text-sm leading-3 text-ink outline-none"
                    placeholder="Например, добавь школу № 31 в Якутске" required @keydown="chatKeydown" />
                  <div class="mt-1 flex justify-end">
                    <button type="submit" aria-label="Отправить" title="Отправить"
                      class="grid size-11 place-items-center rounded-full bg-accent text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                      :disabled="!!pending || dirty || !input.trim()">
                      <span aria-hidden="true" class="relative block size-5">
                        <span class="absolute left-1/2 top-1 size-2.5 -translate-x-1/2 rotate-45 border-l-2 border-t-2"></span>
                        <span class="absolute inset-y-[3px] left-1/2 w-0.5 -translate-x-1/2 bg-current"></span>
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </section>
            <section class="flex min-w-0 flex-col rounded-ui border border-line bg-surface p-4 sm:p-5 lg:h-[clamp(32rem,72dvh,52rem)]"
              aria-labelledby="campaign-schools-title">
              <header class="shrink-0">
                <h3 id="campaign-schools-title" class="text-lg font-semibold">Подборка школ</h3>
                <p v-if="!campaign.schools.length" class="mt-2 text-sm text-secondary">Добавьте школу через чат или попросите создать подборку.</p>
                <p v-else class="mt-2 text-sm text-secondary" aria-live="polite">
                  Всего школ: {{ campaign.schools.length }} · Для письма: {{ recipients.length }} из {{ schoolMailLimit }}
                </p>
                <p v-if="sentCount" class="mt-1 text-sm text-secondary">Писем принято почтовым сервером: {{ sentCount }}.</p>
              </header>
              <ul ref="schoolList" class="mt-2 max-h-[24rem] min-h-0 divide-y divide-line overflow-y-auto [scrollbar-gutter:stable]">
                <li v-for="school in campaign.schools" :key="school.id" class="px-2 py-3 text-sm [overflow-wrap:anywhere]"
                  :class="{ 'bg-accent-soft': highlightedSchool === school.id }">
                  <label class="flex items-start gap-2">
                    <input type="checkbox" class="mt-0.5 size-4 shrink-0 accent-accent" :checked="selected.has(school.id)"
                      :disabled="!eligible.has(school.id) || (!selected.has(school.id) && recipients.length >= schoolMailLimit)"
                      @change="toggle(school.id)" />
                    <span>
                      <span class="font-semibold">{{ school.name }}</span>
                      <span class="block text-xs text-secondary">{{ school.city }} · {{ school.institutionEmail || "Нет адреса" }}</span>
                    </span>
                  </label>
                  <div class="ml-6 mt-1 text-xs text-secondary">
                    <p v-if="statuses.has(school.id)">{{ deliveryLabels[statuses.get(school.id)!] }}</p>
                    <template v-if="campaign.state.upperGrades">
                      <p v-if="school.schoolEnrollment">
                        <span v-if="school.schoolEnrollment.grade10 != null">10 класс — {{ school.schoolEnrollment.grade10 }}. </span>
                        <span v-if="school.schoolEnrollment.grade11 != null">11 класс — {{ school.schoolEnrollment.grade11 }}. </span>
                        <span v-if="school.schoolEnrollment.upperGrades != null">10–11 классы — {{ school.schoolEnrollment.upperGrades }}. </span>
                        <span v-if="school.schoolEnrollment.grade10 == null && school.schoolEnrollment.grade11 == null &&
                          school.schoolEnrollment.upperGrades == null">Данные о 10–11 классах не подтверждены. </span>
                        <a :href="school.schoolEnrollment.sourceUrl" target="_blank" rel="noopener noreferrer" class="text-accent underline">Данные о классах</a>
                      </p>
                      <p v-else>Данные о 10–11 классах не подтверждены.</p>
                    </template>
                    <a v-if="school.sourceUrls[0]" :href="school.sourceUrls[0]" target="_blank" rel="noopener noreferrer"
                      class="text-accent underline">Источник школы</a>
                  </div>
                </li>
              </ul>
              <div v-if="campaign.state.draft" class="mt-4 grid shrink-0 gap-2 border-t border-line pt-4 text-sm">
                <details :key="campaign.id">
                  <summary class="cursor-pointer font-semibold text-ink">Черновик письма</summary>
                  <p class="mt-2 font-medium [overflow-wrap:anywhere]">{{ campaign.state.draft.subject }}</p>
                  <p class="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{{ sample }}</p>
                </details>
                <p v-if="mailLocked" class="text-xs text-secondary">Завершите текущую рассылку в разделе «Почта».</p>
                <p v-else-if="!recipients.length" class="text-xs text-secondary">Выберите хотя бы одну школу с адресом.</p>
                <button type="button" :class="primary" class="mt-1 justify-self-start"
                  :disabled="mailLocked || !!pending || dirty || !recipients.length" @click="prepareMail">Открыть в почте</button>
              </div>
            </section>
          </div>
        </template>
    </div>
  </section>
</template>
