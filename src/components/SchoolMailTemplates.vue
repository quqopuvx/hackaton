<script setup lang="ts">
import { apiFetch } from "../session-api";
import { computed, nextTick, onUnmounted, ref } from "vue";
import { schoolMailDraft, schoolMailLayouts, schoolMailSubjectLimit, schoolMailTemplates, schoolMailTextLimit, schoolNameToken } from "../../lib/school-mail";
import type { SavedSchoolMailTemplate, SchoolMailLayout } from "../../lib/school-mail";
import SchoolMailPreview from "./SchoolMailPreview.vue";
import MailDesignEditor from "./MailDesignEditor.vue";
import { defaultMailDesign, mailDesignText } from "../../lib/school-mail-design";
import { fetchMailTemplate } from "../school-mail-template-api";

const props = defineProps<{ templates?: SavedSchoolMailTemplate[]; loading?: boolean; loadError?: string; createOnly?: boolean }>();
const emit = defineEmits<{ saved: [template: SavedSchoolMailTemplate]; deleted: [id: string]; cancel: [] }>();
const id = ref<string>();
const name = ref("");
const subject = ref("");
const text = ref("");
const layout = ref<SchoolMailLayout>("plain");
const design = ref(defaultMailDesign());
const useDesign = ref(true);
const loadingDesign = ref(false);
const processingImages = ref(false);
const designLoadError = ref("");
const blocked = computed(() => saving.value || deleting.value || loadingDesign.value || processingImages.value);
defineExpose({ blocked });
const overLimit = computed(() => useDesign.value && mailDesignText(design.value, text.value).length > schoolMailTextLimit);
const mode = computed({
  get: () => useDesign.value ? "design" : layout.value,
  set: (value: "design" | SchoolMailLayout) => {
    useDesign.value = value === "design";
    if (value !== "design") layout.value = value;
  },
});
let designRequest: AbortController | undefined;
onUnmounted(() => designRequest?.abort());
const presets = ["promotion", "invitation", "newsletter"] as const;
const saving = ref(false);
const deleting = ref(false);
const deleteDialog = ref<HTMLDialogElement>();
const deleteError = ref("");
const activeTemplate = computed(() => props.templates?.find((template) => template.id === id.value));
const newTemplateButton = ref<HTMLButtonElement>();
const error = ref("");
const notice = ref("");
const inputClass = "min-h-11 w-full rounded-ui border border-line bg-canvas px-3 text-sm focus-visible:outline-accent";

function setDraft(template?: SavedSchoolMailTemplate): void {
  id.value = template?.id;
  name.value = template?.name ?? "";
  subject.value = template?.subject ?? "";
  text.value = template?.text ?? "";
  layout.value = template?.layout ?? "plain";
  design.value = template?.design ? JSON.parse(JSON.stringify(template.design)) : defaultMailDesign();
  useDesign.value = !template || Boolean(template.hasDesign || template.design);
  error.value = "";
  notice.value = "";
  designLoadError.value = "";
}

async function edit(template?: SavedSchoolMailTemplate): Promise<void> {
  designRequest?.abort();
  setDraft(template);
  if (!template?.hasDesign || template.design) {
    loadingDesign.value = false;
    return;
  }
  const controller = new AbortController();
  designRequest = controller;
  loadingDesign.value = true;
  try {
    const fullTemplate = await fetchMailTemplate(template.id, controller.signal);
    if (!controller.signal.aborted) setDraft(fullTemplate);
  } catch (cause) {
    if (!controller.signal.aborted) designLoadError.value = cause instanceof Error ? cause.message : "Не удалось загрузить оформление.";
  } finally {
    if (!controller.signal.aborted) loadingDesign.value = false;
  }
}

function startFrom(preset: typeof presets[number]): void {
  void edit();
  useDesign.value = false;
  name.value = schoolMailTemplates[preset];
  subject.value = schoolMailTemplates[preset];
  text.value = schoolMailDraft(preset);
  layout.value = preset;
}

function cancelEdit(): void {
  if (props.createOnly) {
    emit("cancel");
    return;
  }
  void edit();
  void nextTick(() => newTemplateButton.value?.focus());
}

function confirmDelete(): void {
  if (!activeTemplate.value || blocked.value) return;
  deleteError.value = "";
  deleteDialog.value?.showModal();
}

function closeDelete(): void {
  if (!deleting.value) deleteDialog.value?.close();
}

async function removeTemplate(): Promise<void> {
  const target = activeTemplate.value;
  if (!target || deleting.value || !deleteDialog.value?.open) return;
  deleting.value = true;
  deleteError.value = "";
  try {
    const response = await apiFetch("/api/school-mail/templates/" + encodeURIComponent(target.id), { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      const data = await response.json();
      throw new Error(data.error || "Не удалось удалить шаблон.");
    }
    deleteDialog.value.close();
    cancelEdit();
    emit("deleted", target.id);
    notice.value = "Шаблон удалён.";
  } catch (cause) {
    deleteError.value = cause instanceof Error ? cause.message : "Не удалось удалить шаблон.";
  } finally {
    deleting.value = false;
  }
}

async function save(): Promise<void> {
  if (blocked.value || designLoadError.value || overLimit.value || !name.value.trim() || !subject.value.trim() || !text.value.trim()) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const response = await apiFetch("/api/school-mail/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: id.value, name: name.value, subject: subject.value, text: text.value, layout: layout.value,
        design: useDesign.value ? design.value : null,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить шаблон.");
    setDraft(data.template);
    emit("saved", data.template);
    notice.value = "Шаблон сохранён и доступен во вкладке «Отправка».";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось сохранить шаблон.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="grid items-start gap-4" aria-label="Шаблоны писем"
    :class="createOnly ? 'lg:grid-cols-2' : 'lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.65fr)_minmax(0,1.2fr)]'">
    <div v-if="!createOnly" class="min-w-0 space-y-4 rounded-ui border border-line bg-surface p-4 sm:p-5">
      <div>
        <h3 class="text-lg font-semibold">Готовые шаблоны</h3>
        <ul class="mt-2 space-y-2">
          <li v-for="preset in presets" :key="preset">
            <button type="button" :disabled="blocked"
              class="min-h-11 w-full rounded-ui border border-line bg-canvas px-3 text-left text-sm font-semibold hover:border-accent disabled:opacity-50"
              @click="startFrom(preset)">{{ schoolMailTemplates[preset] }}</button>
          </li>
        </ul>
      </div>
      <div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-lg font-semibold">Свои шаблоны</h3>
          <button ref="newTemplateButton" type="button" :disabled="blocked" class="min-h-11 text-sm font-medium text-accent disabled:opacity-50"
            @click="edit()">Новый шаблон</button>
        </div>
        <p v-if="loadError" role="alert" class="text-sm text-danger">{{ loadError }}</p>
        <p v-else-if="loading && !templates?.length" role="status" class="text-sm text-secondary">Загружаю шаблоны…</p>
        <p v-else-if="!templates?.length" class="text-sm text-secondary">Сохранённых шаблонов пока нет.</p>
        <ul v-else class="mt-2 space-y-1 [overflow-wrap:anywhere]">
          <li v-for="template in templates" :key="template.id">
            <button type="button" :disabled="blocked" :aria-pressed="id === template.id"
              class="block min-h-11 w-full rounded-ui border px-3 py-2 text-left text-sm"
              :class="id === template.id ? 'border-accent bg-canvas' : 'border-transparent hover:bg-canvas'"
              @click="edit(template)">
              <span class="block font-semibold">{{ template.name }}</span>
              <span class="block text-xs text-secondary">{{ template.subject }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
    <form class="min-w-0 space-y-4 rounded-2xl border border-line bg-surface p-4 sm:p-5" @submit.prevent="save">
      <h3 v-if="!createOnly" class="text-lg font-semibold">{{ id ? "Редактирование шаблона" : "Новый шаблон" }}</h3>
      <fieldset :disabled="blocked || !!designLoadError" class="min-w-0 space-y-4">
      <label class="grid gap-1 text-sm font-medium">
        Название шаблона
        <input v-model="name" :class="inputClass" maxlength="100" :autofocus="createOnly" required :disabled="blocked" />
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Тема письма
        <input v-model="subject" :class="inputClass" :maxlength="schoolMailSubjectLimit" required :disabled="blocked" />
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Оформление письма
        <select v-model="mode" :class="inputClass">
          <option value="design">Конструктор</option>
          <option v-for="(label, key) in schoolMailLayouts" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <MailDesignEditor v-if="useDesign && !loadingDesign && !designLoadError" v-model:design="design" v-model:body="text"
        :disabled="saving" @processing="processingImages = $event" />
      <label v-else-if="!useDesign" class="grid gap-1 text-sm font-medium">
        Текст письма
        <textarea v-model="text" rows="7" :class="inputClass" class="resize-y py-3"
          :maxlength="schoolMailTextLimit" required :disabled="blocked" />
        <span class="text-xs font-normal text-secondary">Вместо <code>{{ schoolNameToken }}</code> подставится название учреждения.</span>
      </label>
      </fieldset>
      <p v-if="loadingDesign" role="status" class="text-sm text-secondary">Загружаю оформление…</p>
      <p v-if="designLoadError" role="alert" class="text-sm text-danger">{{ designLoadError }}</p>
      <p v-if="overLimit" role="alert" class="text-sm text-danger">Сократите общий текст письма до {{ schoolMailTextLimit }} символов.</p>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <p v-if="notice" role="status" class="text-sm text-accent">{{ notice }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" :disabled="blocked || !!designLoadError || overLimit" class="min-h-11 rounded-ui bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
          {{ saving ? "Сохраняю…" : "Сохранить шаблон" }}
        </button>
        <button type="button" :disabled="saving || deleting || processingImages"
          class="min-h-11 rounded-ui border border-line px-4 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-50"
          @click="cancelEdit">Отменить</button>
        <button v-if="activeTemplate" type="button" :disabled="blocked"
          class="min-h-11 rounded-ui border border-line px-4 text-sm font-semibold text-danger disabled:opacity-50"
          @click="confirmDelete">Удалить шаблон</button>
      </div>
    </form>
    <dialog v-if="!createOnly" ref="deleteDialog" aria-labelledby="delete-template-title" aria-describedby="delete-template-description"
      class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-ui border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-slate-900/45 sm:p-7"
      @cancel.prevent="closeDelete">
      <h3 id="delete-template-title" class="text-lg font-semibold">Удалить шаблон?</h3>
      <p id="delete-template-description" class="mt-2 text-sm text-secondary [overflow-wrap:anywhere]">
        Шаблон «{{ activeTemplate?.name }}» будет удалён из списка.
      </p>
      <p v-if="deleteError" role="alert" class="mt-3 text-sm text-danger">{{ deleteError }}</p>
      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" :disabled="deleting" autofocus
          class="min-h-11 rounded-ui border border-line px-4 text-sm font-semibold text-accent disabled:opacity-50"
          @click="closeDelete">Отмена</button>
        <button type="button" :disabled="deleting"
          class="min-h-11 rounded-ui border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50"
          @click="removeTemplate">{{ deleting ? "Удаляю…" : "Удалить" }}</button>
      </div>
    </dialog>
    <SchoolMailPreview v-if="!loadingDesign && !designLoadError && (subject.trim() || text.trim() || useDesign)"
      class="min-w-0" :class="createOnly ? 'lg:sticky lg:top-2' : 'lg:col-start-2 xl:sticky xl:top-2 xl:row-start-1 xl:col-start-3'"
      :subject="subject.trim()" :text="text" :layout="layout" :design="useDesign ? design : null" school-name="Школа № 1" />
  </section>
</template>
