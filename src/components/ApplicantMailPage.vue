<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ApplicantMailRecipient } from "../../lib/olympiad";
import { apiFetch } from "../session-api";
import ApplicantMailForm from "./ApplicantMailForm.vue";

const recipients = ref<ApplicantMailRecipient[]>([]);
const selected = ref(new Set<string>());
const query = ref("");
const loading = ref(true);
const error = ref("");
const setupError = ref("");
const locked = ref(false);
const composerKey = ref(0);
const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е");
const visible = computed(() => {
  const term = normalize(query.value.trim());
  return recipients.value.filter(({ name, email }) => normalize(`${name} ${email}`).includes(term));
});
const targets = computed(() => recipients.value.filter(({ id }) => selected.value.has(id)));
const allSelected = computed(() => recipients.value.length > 0 && targets.value.length === recipients.value.length);

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await apiFetch("/api/olympiad/applicant-mail/recipients");
    if (!response.ok) throw new Error();
    const data: { recipients: ApplicantMailRecipient[]; setupError?: string } = await response.json();
    recipients.value = data.recipients;
    setupError.value = data.setupError ?? "";
  } catch {
    error.value = "Не удалось загрузить абитуриентов.";
  } finally {
    loading.value = false;
  }
}

function toggle(id: string): void {
  if (locked.value) return;
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
}

function reset(): void {
  selected.value.clear();
  locked.value = false;
  composerKey.value++;
  void load();
}

onMounted(load);
</script>

<template>
  <div class="grid items-start gap-4 lg:grid-cols-2">
    <section class="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-labelledby="applicant-recipients-title">
      <h3 id="applicant-recipients-title" class="text-lg font-bold">Абитуриенты</h3>
      <label class="mt-3 grid gap-1 text-sm">Поиск получателя
        <input v-model="query" type="search" placeholder="Имя или почта"
          class="min-h-11 rounded-xl border border-line bg-canvas px-3 focus-visible:outline-accent" />
      </label>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" :disabled="locked || loading || !recipients.length || allSelected"
          class="min-h-11 rounded-ui border border-line px-3 text-sm font-bold text-accent enabled:hover:bg-accent-soft disabled:opacity-50"
          @click="selected = new Set(recipients.map(({ id }) => id))">Выбрать всех</button>
        <button v-if="selected.size" type="button" :disabled="locked" class="min-h-11 px-3 text-sm font-bold text-accent disabled:opacity-50"
          @click="selected.clear()">Снять выбор</button>
        <span role="status" class="text-sm text-secondary">Выбрано {{ targets.length }} из {{ recipients.length }}</span>
      </div>
      <p v-if="loading" role="status" class="mt-3 text-sm text-secondary">Загружаю абитуриентов…</p>
      <div v-else-if="error" class="mt-3 text-sm">
        <p role="alert" class="text-danger">{{ error }}</p>
        <button type="button" class="min-h-11 font-bold text-accent" @click="load">Повторить загрузку</button>
      </div>
      <p v-else-if="!visible.length" class="mt-3 text-sm text-secondary">Получатели не найдены.</p>
      <ul v-else class="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto">
        <li v-for="recipient in visible" :key="recipient.id">
          <label class="flex items-start gap-3 py-3 text-sm [overflow-wrap:anywhere]">
            <input type="checkbox" class="mt-1 size-4 shrink-0 accent-accent" :checked="selected.has(recipient.id)"
              :disabled="locked" @change="toggle(recipient.id)" />
            <span class="min-w-0"><span class="block font-bold">{{ recipient.name }}</span><span class="text-secondary">{{ recipient.email }}</span></span>
          </label>
        </li>
      </ul>
    </section>
    <ApplicantMailForm :key="composerKey" :recipients="targets" :setup-error="setupError" :all-selected="allSelected" bulk
      @lock="locked = true" @close="reset" />
  </div>
</template>
