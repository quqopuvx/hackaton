<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { institutionTypeLabels, type InstitutionType } from "../../lib/institution-types";
import type { Institution, InstitutionEdits } from "../../lib/types";

const props = defineProps<{ institution: Institution; saving: boolean; error: string }>();
const emit = defineEmits<{ close: []; save: [edits: InstitutionEdits] }>();
const dialog = ref<HTMLDialogElement>();
const fields = [
  { key: "name", label: "Название учреждения", required: true },
  { key: "city", label: "Город", required: true },
  { key: "region", label: "Регион", required: true },
  { key: "leaderName", label: "Руководитель", required: false },
  { key: "institutionEmail", label: "Почта учреждения", required: false },
  { key: "institutionPhone", label: "Телефон учреждения", required: false },
] as const;
const draft = ref({
  name: props.institution.name,
  city: props.institution.city,
  region: props.institution.region,
  leaderName: props.institution.leaderName ?? "",
  institutionEmail: props.institution.institutionEmail ?? "",
  institutionPhone: props.institution.institutionPhone ?? "",
  institutionType: props.institution.institutionType ?? ("" as const),
  sources: props.institution.sourceUrls.join("\n"),
});
const edits = computed(() => {
  const changes: InstitutionEdits = {};
  for (const { key, required } of fields) {
    const current = props.institution[key] ?? "";
    const input = draft.value[key];
    if (input === current) continue;
    const value = input.trim();
    if (required) changes[key] = value;
    else changes[key] = value || null;
  }
  const type: InstitutionType | null = draft.value.institutionType || null;
  if (type !== props.institution.institutionType) changes.institutionType = type;
  if (draft.value.sources !== props.institution.sourceUrls.join("\n")) {
    changes.sourceUrls = draft.value.sources.split(/\r?\n/).map((source) => source.trim()).filter(Boolean);
  }
  return changes;
});
const hasEdits = computed(() => Object.keys(edits.value).length > 0);
const inputClass = "min-w-0 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-accent sm:text-sm";

function close(): void {
  if (!props.saving) emit("close");
}

onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog ref="dialog" aria-labelledby="institution-editor-title" @cancel.prevent="close"
    class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-slate-900/45 sm:p-7">
    <h2 id="institution-editor-title" class="mb-5 text-xl font-semibold">Редактирование учреждения</h2>
    <form @submit.prevent="hasEdits && !saving && emit('save', edits)">
      <fieldset :disabled="saving" class="grid min-w-0 gap-4 sm:grid-cols-2">
        <label v-for="field in fields" :key="field.key" class="grid min-w-0 gap-1 text-sm text-secondary"
          :class="{ 'sm:col-span-2': field.key === 'name' }">
          {{ field.label }}
          <input v-model="draft[field.key]" :required="field.required" :autofocus="field.key === 'name'"
            :inputmode="field.key === 'institutionEmail' ? 'email' : field.key === 'institutionPhone' ? 'tel' : 'text'"
            maxlength="500" :class="inputClass" />
        </label>
        <label class="grid min-w-0 gap-1 text-sm text-secondary">
          Тип учреждения
          <select v-model="draft.institutionType" :class="inputClass">
            <option value="">Не указан</option>
            <option v-for="(label, value) in institutionTypeLabels" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label class="grid min-w-0 gap-1 text-sm text-secondary sm:col-span-2">
          Ссылки на источники
          <textarea v-model="draft.sources" rows="3" :class="inputClass" aria-describedby="institution-sources-hint" />
          <span id="institution-sources-hint" class="text-xs">Одна ссылка на строку.</span>
        </label>
      </fieldset>
      <p v-if="error" role="alert" class="mt-4 text-sm text-danger">{{ error }}</p>
      <div class="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" :disabled="saving" class="min-h-11 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
          @click="close">Отмена</button>
        <button type="submit" :disabled="saving || !hasEdits"
          class="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">
          {{ saving ? "Сохраняю…" : "Сохранить" }}
        </button>
      </div>
    </form>
  </dialog>
</template>
