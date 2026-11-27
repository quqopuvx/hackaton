<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { CampaignMailPreset } from "../../lib/campaigns";
import { isSingleEmail, schoolMailLimit } from "../../lib/school-mail";
import type { SavedSchoolMailTemplate, SchoolMailOutcome, SchoolReply } from "../../lib/school-mail";
import type { Institution } from "../../lib/types";
import SchoolMailPanel from "./SchoolMailPanel.vue";
import SchoolRepliesPanel from "./SchoolRepliesPanel.vue";
import SchoolMailHistory from "./SchoolMailHistory.vue";
import ApplicantMailPage from "./ApplicantMailPage.vue";
import type { Preferences } from "../preferences";

const props = defineProps<{
  institutions: Institution[];
  selected: Set<string>;
  selectedRecipients: Institution[];
  locked: boolean;
  loading: boolean;
  error: string;
  active: boolean;
  composeRequest: number;
  savedTemplates: SavedSchoolMailTemplate[];
  preferences: Preferences;
  campaignMail?: CampaignMailPreset;
}>();

const emit = defineEmits<{
  toggle: [id: string]; chooseRecipients: [ids: string[]]; lock: []; unlock: []; reset: []; sent: [];
  replies: [replies: SchoolReply[]]; delivery: [requestId: string, outcomes: SchoolMailOutcome[]];
  deliveryError: [requestId: string, message: string]; returnToRecipients: []; templateSaved: [template: SavedSchoolMailTemplate];
}>();
const query = ref("");
const tabs = { compose: "Отправка", applicants: "Абитуриенты", replies: "Ответы", history: "Отправленные" } as const;
const panel = ref<keyof typeof tabs>("compose");
const applicantsOpened = ref(false);
watch(panel, (current) => { if (current === "applicants") applicantsOpened.value = true; });
const composerKey = ref(0);
const composerOpened = ref(false);
const reminderPreset = ref(false);
watch(() => props.composeRequest, async () => {
  panel.value = "compose";
  await nextTick();
  document.getElementById("school-mail-title")?.focus();
});
watch(() => props.campaignMail, () => {
  composerKey.value++;
  if (props.campaignMail) {
    reminderPreset.value = false;
    query.value = "";
  }
});
watch(() => props.selectedRecipients.length, (count) => {
  if (count) composerOpened.value = true;
}, { immediate: true });

function resetComposer(): void {
  composerOpened.value = false;
  reminderPreset.value = false;
  emit("reset");
}

function prepareReminder(ids: string[]): void {
  if (props.locked || !ids.length) return;
  emit("chooseRecipients", ids);
  composerKey.value++;
  reminderPreset.value = true;
  query.value = "";
  panel.value = "compose";
}
const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е");
const visibleInstitutions = computed(() => {
  const terms = normalize(query.value).trim().split(/\s+/).filter(Boolean);
  return props.institutions.filter((institution) => {
    if (props.campaignMail && (institution.institutionType !== "school" ||
        !props.campaignMail.recipientIds.includes(institution.id))) return false;
    const text = normalize([institution.name, institution.city, institution.region, institution.institutionEmail].join(" "));
    return terms.every((term) => text.includes(term));
  });
});
</script>

<template>
  <section aria-labelledby="mail-page-title"
    class="min-h-0 w-full flex-1 overflow-y-auto pt-4 pb-5 [scrollbar-gutter:stable] sm:pt-5">
    <h2 id="mail-page-title" class="mb-4 text-xl font-extrabold text-accent sm:text-2xl">Почта</h2>
    <nav aria-label="Разделы почты" class="mb-4 flex flex-wrap gap-2 border-b border-line">
      <button v-for="(label, key) in tabs" :key="key" type="button" class="min-h-11 border-b-2 px-3 text-sm font-semibold motion-safe:transition-colors"
        :aria-pressed="panel === key" :class="panel === key ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="panel = key">{{ label }}</button>
    </nav>
    <div class="relative">
      <Transition name="mail-panel">
        <ApplicantMailPage v-if="applicantsOpened" v-show="panel === 'applicants'" :inert="panel !== 'applicants'" />
      </Transition>
      <Transition name="mail-panel">
        <SchoolRepliesPanel v-show="panel === 'replies'" :inert="panel !== 'replies'" :active="active && panel === 'replies'"
          @synced="emit('sent'); emit('replies', $event)" />
      </Transition>
      <Transition name="mail-panel">
        <SchoolMailHistory v-show="panel === 'history'" :inert="panel !== 'history'" :active="active && panel === 'history'" :locked="locked"
          :default-days="preferences.reminderDays" :exclude-replied="preferences.excludeReplied" @prepare="prepareReminder" />
      </Transition>
      <Transition name="mail-panel">
        <div v-show="panel === 'compose'" :inert="panel !== 'compose'" class="grid items-start gap-4 lg:grid-cols-2">
          <section class="min-w-0 rounded-ui border border-line bg-surface p-4 sm:p-5" aria-labelledby="mail-recipients-title">
            <h3 id="mail-recipients-title" class="text-lg font-semibold">Выбор получателей</h3>
            <label class="mt-3 grid gap-1 text-sm font-medium">
              Поиск учреждения
              <input v-model="query" type="search" placeholder="Название, город, регион или почта"
                class="min-h-11 rounded-ui border border-line bg-canvas px-3 text-sm focus-visible:outline-accent" />
            </label>
            <p class="mt-3 text-sm text-secondary" aria-live="polite">Выбрано {{ selected.size }} из {{ schoolMailLimit }}</p>
            <p v-if="error" role="alert" class="mt-3 text-sm text-danger">{{ error }}</p>
            <p v-else-if="loading && !institutions.length" class="mt-3 text-sm text-secondary">Загружаю учреждения…</p>
            <p v-else-if="!institutions.length" class="mt-3 text-sm text-secondary">
              В реестре пока нет учреждений. Добавьте их через раздел «Поиск».
            </p>
            <p v-else-if="!visibleInstitutions.length" class="mt-3 text-sm text-secondary">Получатели не найдены.</p>
            <ul v-else class="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto">
              <li v-for="institution in visibleInstitutions" :key="institution.id">
                <label class="flex min-h-12 items-start gap-3 py-3 text-sm [overflow-wrap:anywhere]">
                  <input type="checkbox" class="mt-0.5 size-4 shrink-0 accent-accent" :checked="selected.has(institution.id)"
                    :aria-label="`Выбрать для письма: ${institution.name}`"
                    :disabled="locked || (!selected.has(institution.id) &&
                      (selected.size >= schoolMailLimit || !isSingleEmail(institution.institutionEmail?.trim() ?? '')))"
                    @change="emit('toggle', institution.id)" />
                  <span class="min-w-0">
                    <span class="font-medium">{{ institution.name }}</span>
                    <span class="block text-xs text-secondary">{{ institution.city }} · {{ institution.region }}</span>
                    <span class="block text-xs text-secondary">
                      {{ isSingleEmail(institution.institutionEmail?.trim() ?? '') ? institution.institutionEmail : "Добавьте почту в карточке учреждения" }}
                    </span>
                  </span>
                </label>
              </li>
            </ul>
          </section>
          <SchoolMailPanel v-if="composerOpened" :key="composerKey" :recipients="selectedRecipients"
            :saved-templates="savedTemplates" :reminder-preset="reminderPreset" :campaign-mail="campaignMail"
            :active="active && panel === 'compose'" :default-template="preferences.defaultTemplate" :signature="preferences.signature" :reply-to="preferences.replyTo"
            @delivery="(id, outcomes) => emit('delivery', id, outcomes)" @delivery-error="(id, message) => emit('deliveryError', id, message)"
            @lock="emit('lock')" @unlock="emit('unlock')" @reset="resetComposer" @sent="emit('sent')"
            @return-to-recipients="emit('returnToRecipients')" @template-saved="emit('templateSaved', $event)" />
          <section v-else class="rounded-ui border border-line bg-surface p-4 sm:p-5">
            <h3 class="text-lg font-semibold">Письма учреждениям</h3>
            <p class="mt-2 text-sm text-secondary">Выберите получателя, чтобы выбрать шаблон и посмотреть письмо.</p>
          </section>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .mail-panel-enter-active {
    position: relative;
    z-index: 1;
    transition: opacity 220ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mail-panel-leave-active {
    position: absolute;
    inset: 0 0 auto;
    pointer-events: none;
    transition: opacity 150ms ease-in, transform 150ms ease-in;
  }

  .mail-panel-enter-from {
    opacity: 0;
    transform: translateY(6px);
  }

  .mail-panel-leave-to {
    opacity: 0;
    transform: translateY(-3px);
  }
}
</style>
