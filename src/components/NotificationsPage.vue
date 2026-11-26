<script setup lang="ts">
import { computed } from "vue";
import { notificationLabels, type AppNotification, type NotificationKind, type Preferences } from "../preferences";

const props = defineProps<{
  items: AppNotification[];
  enabled: Preferences["notifications"];
  refreshing: boolean;
  error: string;
}>();
const emit = defineEmits<{ toggle: [kind: NotificationKind, enabled: boolean]; refresh: [] }>();
const visible = computed(() => props.items.filter((item) => props.enabled[item.kind]));
const dateFormat = new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" });
</script>

<template>
  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    <fieldset class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <legend class="px-2 font-semibold">Какие уведомления показывать</legend>
      <label v-for="(label, kind) in notificationLabels" :key="kind" class="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" :checked="enabled[kind]" class="size-4 shrink-0 accent-accent"
          @change="emit('toggle', kind, ($event.target as HTMLInputElement).checked)" />
        {{ label }}
      </label>
    </fieldset>
    <section class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="notification-feed">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id="notification-feed" class="text-lg font-semibold">Лента</h3>
        <button v-if="enabled.reply" type="button" :disabled="refreshing" class="min-h-11 rounded-ui border border-line px-4 text-sm text-accent disabled:opacity-50"
          @click="emit('refresh')">{{ refreshing ? "Проверяю ответы…" : "Проверить ответы" }}</button>
      </div>
      <p v-if="error && enabled.reply" role="alert" class="mt-2 text-sm text-danger">{{ error }}</p>
      <p v-if="!visible.length" class="mt-2 text-sm text-secondary">Уведомлений пока нет.</p>
      <ul v-else class="mt-2 divide-y divide-line [overflow-wrap:anywhere]">
        <li v-for="item in visible" :key="item.id" class="py-3">
          <div class="flex flex-wrap items-baseline justify-between gap-x-3">
            <p class="text-sm font-semibold" :class="{ 'text-danger': item.kind === 'sendError' }">{{ notificationLabels[item.kind] }}</p>
            <time :datetime="item.date" class="text-xs text-secondary">{{ dateFormat.format(new Date(item.date)) }}</time>
          </div>
          <p class="text-sm text-secondary">{{ item.text }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
