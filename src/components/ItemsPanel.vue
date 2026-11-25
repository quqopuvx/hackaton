<script setup lang="ts">
import { ref } from "vue";
import { domain } from "../../config/domain";
import type { Item } from "../../lib/types";

const props = defineProps<{ items: Item[] }>();
const emit = defineEmits<{ changed: [] }>();

const busy = ref(false);
const error = ref("");
const title = ref("");

const labels: Record<Item["status"], string> = {
  new: "Новая",
  in_progress: "В работе",
  done: "Готово",
};

const styles: Record<Item["status"], string> = {
  new: "bg-slate-100 text-secondary",
  in_progress: "bg-amber-50 text-amber-700",
  done: "bg-emerald-50 text-emerald-700",
};

async function create(): Promise<void> {
  const value = title.value.trim();
  if (!value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: value }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
    title.value = "";
    emit("changed");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function advance(item: Item): Promise<void> {
  const next: Item["status"] = item.status === "new" ? "in_progress" : "done";
  const response = await fetch("/api/items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: item.id, status: next }),
  });
  if (response.ok) emit("changed");
}
</script>

<template>
  <section class="mx-auto max-w-4xl">
    <div class="rounded-[2rem] border border-line bg-surface p-5 shadow-[0_20px_40px_-15px_rgba(24,24,27,0.06)] sm:p-6">
      <label for="item-title" class="font-mono text-[11px] uppercase tracking-widest text-muted">
        {{ domain.entity.createLabel }}
      </label>
      <div class="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="item-title"
          v-model="title"
          type="text"
          placeholder="Короткое название"
          class="min-h-11 flex-1 rounded-2xl border border-line bg-canvas px-4 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          @keydown.enter="create"
        />
        <button
          type="button"
          :disabled="busy || !title.trim()"
          class="min-h-11 shrink-0 rounded-2xl bg-accent px-6 text-sm font-medium text-white transition-transform active:-translate-y-px disabled:bg-slate-200 disabled:text-muted"
          @click="create"
        >
          Добавить
        </button>
      </div>
      <p v-if="error" class="mt-3 rounded-xl border border-danger/30 bg-rose-50 px-3 py-2 text-sm text-danger">
        {{ error }}
      </p>
    </div>

    <div class="mt-6 overflow-hidden rounded-[2rem] border border-line bg-surface">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-line bg-canvas/70 font-mono text-[11px] uppercase tracking-widest text-muted">
          <tr>
            <th class="px-5 py-4 font-normal">{{ domain.entity.singular }}</th>
            <th class="px-5 py-4 font-normal">Статус</th>
            <th class="px-5 py-4 text-right font-normal">Действие</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr
            v-for="(item, index) in props.items"
            :key="item.id"
            class="rise transition-colors hover:bg-canvas"
            :style="{ '--delay': `${index * 50}ms` }"
          >
            <td class="px-5 py-4 text-ink">{{ item.title }}</td>
            <td class="px-5 py-4">
              <span class="rounded-full px-2.5 py-1 text-xs" :class="styles[item.status]">
                {{ labels[item.status] }}
              </span>
            </td>
            <td class="px-5 py-4 text-right">
              <button
                v-if="item.status !== 'done'"
                type="button"
                class="min-h-11 rounded-xl px-3 text-sm text-accent hover:bg-accent-soft"
                @click="advance(item)"
              >
                {{ item.status === 'new' ? 'В работу' : 'Завершить' }}
              </button>
              <span v-else class="font-mono text-xs text-muted">—</span>
            </td>
          </tr>
          <tr v-if="props.items.length === 0">
            <td colspan="3" class="px-5 py-12">
              <div class="flex flex-col items-center text-center">
                <svg class="h-16 w-20" viewBox="0 0 80 64" fill="none" aria-hidden="true">
                  <rect x="7" y="15" width="52" height="34" rx="6" stroke="#CBD5E1" stroke-width="2" />
                  <rect x="18" y="8" width="52" height="34" rx="6" fill="#FFFFFF" stroke="#94A3B8" stroke-width="2" />
                  <path d="M29 21h26M29 29h18M29 37h22" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" />
                  <circle cx="62" cy="43" r="9" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2" />
                  <path d="M62 39v8M58 43h8" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" />
                </svg>
                <p class="mt-4 font-medium">Здесь появятся {{ domain.entity.plural }}</p>
                <p class="mt-1 max-w-sm text-sm text-secondary">
                  Добавьте первую запись в поле выше или попросите агента сделать это в чате.
                </p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
