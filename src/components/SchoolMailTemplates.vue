<script setup lang="ts">
import { ref } from "vue";
import { personalizeSchoolMail, schoolMailDraft, schoolMailLayouts, schoolMailSubjectLimit, schoolMailTemplates, schoolMailTextLimit, schoolNameToken } from "../../lib/school-mail";
import type { SavedSchoolMailTemplate, SchoolMailLayout } from "../../lib/school-mail";
import SchoolMailPreview from "./SchoolMailPreview.vue";

defineProps<{ templates: SavedSchoolMailTemplate[]; loadError: string }>();
const emit = defineEmits<{ saved: [template: SavedSchoolMailTemplate] }>();
const id = ref<string>();
const name = ref("");
const subject = ref("");
const text = ref("");
const layout = ref<SchoolMailLayout>("plain");
const presets = ["promotion", "invitation", "newsletter"] as const;
const saving = ref(false);
const error = ref("");
const notice = ref("");
const inputClass = "min-h-11 w-full rounded-ui border border-line bg-canvas px-3 text-sm focus-visible:outline-accent";

function edit(template?: SavedSchoolMailTemplate): void {
  id.value = template?.id;
  name.value = template?.name ?? "";
  subject.value = template?.subject ?? "";
  text.value = template?.text ?? "";
  layout.value = template?.layout ?? "plain";
  error.value = "";
  notice.value = "";
}

function startFrom(preset: typeof presets[number]): void {
  edit();
  name.value = schoolMailTemplates[preset];
  subject.value = schoolMailTemplates[preset];
  text.value = schoolMailDraft(preset);
  layout.value = preset;
}

async function save(): Promise<void> {
  if (saving.value || !name.value.trim() || !subject.value.trim() || !text.value.trim()) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const response = await fetch("/api/school-mail/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id.value, name: name.value, subject: subject.value, text: text.value, layout: layout.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить шаблон.");
    edit(data.template);
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
  <section class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" aria-label="Шаблоны писем">
    <div class="min-w-0 space-y-4 rounded-ui border border-line bg-surface p-4 sm:p-5">
      <div>
        <h3 class="text-lg font-semibold">Готовые шаблоны</h3>
        <ul class="mt-2 space-y-2">
          <li v-for="preset in presets" :key="preset">
            <button type="button" :disabled="saving"
              class="min-h-11 w-full rounded-ui border border-line bg-canvas px-3 text-left text-sm font-semibold hover:border-accent disabled:opacity-50"
              @click="startFrom(preset)">{{ schoolMailTemplates[preset] }}</button>
          </li>
        </ul>
      </div>
      <div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-lg font-semibold">Свои шаблоны</h3>
          <button type="button" :disabled="saving" class="min-h-11 text-sm font-medium text-accent disabled:opacity-50"
            @click="edit()">Новый шаблон</button>
        </div>
        <p v-if="loadError" role="alert" class="text-sm text-danger">{{ loadError }}</p>
        <p v-else-if="!templates.length" class="text-sm text-secondary">Сохранённых шаблонов пока нет.</p>
        <ul v-else class="mt-2 space-y-1 [overflow-wrap:anywhere]">
          <li v-for="template in templates" :key="template.id">
            <button type="button" :disabled="saving" :aria-pressed="id === template.id"
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
    <form class="min-w-0 space-y-4 rounded-ui border border-line bg-surface p-4 sm:p-5" @submit.prevent="save">
      <h3 class="text-lg font-semibold">{{ id ? "Редактирование шаблона" : "Новый шаблон" }}</h3>
      <label class="grid gap-1 text-sm font-medium">
        Название шаблона
        <input v-model="name" :class="inputClass" maxlength="100" required :disabled="saving" />
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Тема письма
        <input v-model="subject" :class="inputClass" :maxlength="schoolMailSubjectLimit" required :disabled="saving" />
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Оформление письма
        <select v-model="layout" :class="inputClass" :disabled="saving">
          <option v-for="(label, key) in schoolMailLayouts" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Текст письма
        <textarea v-model="text" rows="7" :class="inputClass" class="resize-y py-3"
          :maxlength="schoolMailTextLimit" required :disabled="saving" />
        <span class="text-xs font-normal text-secondary">Вместо <code>{{ schoolNameToken }}</code> подставится название школы.</span>
      </label>
      <SchoolMailPreview v-if="subject.trim() && text.trim()" :subject="subject.trim()"
        :text="personalizeSchoolMail(text, 'Школа № 1')" :layout="layout" />
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <p v-if="notice" role="status" class="text-sm text-accent">{{ notice }}</p>
      <button type="submit" :disabled="saving" class="min-h-11 rounded-ui bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
        {{ saving ? "Сохраняю…" : "Сохранить шаблон" }}
      </button>
    </form>
  </section>
</template>
