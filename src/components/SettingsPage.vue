<script setup lang="ts">
import { ref } from "vue";
import { isSingleEmail, schoolMailTemplates, type SavedSchoolMailTemplate } from "../../lib/school-mail";
import { reminderIntervals, signatureLimit, type Preferences } from "../preferences";
import { regionMap } from "../regions";

const props = defineProps<{ preferences: Preferences; templates: SavedSchoolMailTemplate[]; storageError: boolean }>();
const emit = defineEmits<{ save: [preferences: Preferences] }>();
const draft = ref({ ...props.preferences });
const status = ref("");
const error = ref("");
const regions = [...regionMap.regions].sort((a, b) => a.name.localeCompare(b.name, "ru"));
const cardClass = "min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5";
const fieldClass = "min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm";

function save(): void {
  const replyTo = draft.value.replyTo.trim();
  if (replyTo && !isSingleEmail(replyTo)) {
    error.value = "Укажите один действительный адрес для ответов.";
    return;
  }
  error.value = "";
  emit("save", { ...draft.value, signature: draft.value.signature.trim(), replyTo });
  status.value = "Настройки применены.";
}
</script>

<template>
  <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="save" @input="status = ''; error = ''">
    <section :class="cardClass" aria-labelledby="settings-appearance">
      <h3 id="settings-appearance" class="text-lg font-semibold">Оформление</h3>
      <label class="grid gap-1 text-sm font-medium">
        Тема
        <select v-model="draft.theme" :class="fieldClass">
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
          <option value="system">Как в системе</option>
        </select>
      </label>
    </section>
    <section :class="cardClass" aria-labelledby="settings-registry">
      <h3 id="settings-registry" class="text-lg font-semibold">Поиск и реестр</h3>
      <label class="grid gap-1 text-sm font-medium">
        Регион реестра по умолчанию
        <select v-model="draft.defaultRegion" :class="fieldClass">
          <option value="">Все регионы</option>
          <option v-for="region in regions" :key="region.code" :value="region.code">{{ region.name }}</option>
        </select>
      </label>
      <label class="flex min-h-11 items-center gap-3 text-sm">
        <input v-model="draft.rememberFilters" type="checkbox" class="size-4 shrink-0 accent-accent" />
        Запоминать фильтры реестра
      </label>
    </section>
    <section :class="cardClass" aria-labelledby="settings-mail">
      <h3 id="settings-mail" class="text-lg font-semibold">Почта</h3>
      <label class="grid gap-1 text-sm font-medium">
        Подпись в новых письмах
        <textarea v-model="draft.signature" :class="fieldClass" class="resize-y py-2" rows="3" :maxlength="signatureLimit" />
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Адрес для ответов
        <input v-model="draft.replyTo" type="email" :class="fieldClass" maxlength="254" placeholder="name@example.ru"
          aria-describedby="settings-reply-to-help" />
        <span id="settings-reply-to-help" class="text-xs font-normal text-secondary">Ответы на другой адрес появятся в приложении, если они поступят в подключённый почтовый ящик.</span>
      </label>
      <label class="grid gap-1 text-sm font-medium">
        Шаблон по умолчанию
        <select v-model="draft.defaultTemplate" :class="fieldClass">
          <option value="">Выбирать вручную</option>
          <option v-if="draft.defaultTemplate && !Object.hasOwn(schoolMailTemplates, draft.defaultTemplate) && !templates.some(item => item.id === draft.defaultTemplate)"
            :value="draft.defaultTemplate">Ранее выбранный шаблон</option>
          <option v-for="(label, key) in schoolMailTemplates" :key="key" :value="key">{{ label }}</option>
          <optgroup v-if="templates.length" label="Сохранённые шаблоны">
            <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
          </optgroup>
        </select>
      </label>
    </section>
    <section :class="cardClass" aria-labelledby="settings-reminders">
      <h3 id="settings-reminders" class="text-lg font-semibold">Повторные рассылки</h3>
      <label class="grid gap-1 text-sm font-medium">
        Срок до напоминания
        <select v-model.number="draft.reminderDays" :class="fieldClass">
          <option v-for="days in reminderIntervals" :key="days" :value="days">{{ days }} дн.</option>
        </select>
      </label>
      <label class="flex min-h-11 items-center gap-3 text-sm">
        <input v-model="draft.excludeReplied" type="checkbox" class="size-4 shrink-0 accent-accent" />
        Исключать ответившие учреждения из списка напоминаний
      </label>
    </section>
    <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
      <button type="submit" class="min-h-11 rounded-ui bg-accent px-5 text-sm font-semibold text-white">Сохранить настройки</button>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <p v-else-if="status" role="status" class="text-sm text-secondary">
        {{ status }} <span v-if="storageError">Браузер не сохранил их для следующего визита.</span>
      </p>
    </div>
  </form>
</template>
