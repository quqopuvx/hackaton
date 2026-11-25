<script setup lang="ts">
import type { TraceEntry } from "../../lib/types";

defineProps<{
  trace: TraceEntry[];
  provider: string;
  steps: number;
}>();

const badges: Record<TraceEntry["kind"], { label: string; style: string }> = {
  call: { label: "вызов", style: "bg-accent-soft text-accent" },
  result: { label: "результат", style: "bg-emerald-50 text-emerald-700" },
  text: { label: "ответ", style: "bg-slate-100 text-secondary" },
  error: { label: "ошибка", style: "bg-rose-50 text-danger" },
};
</script>

<template>
  <section class="mx-auto max-w-4xl">
    <div class="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-line pb-5 font-mono text-xs text-muted">
      <span>провайдер <span class="ml-1 font-medium text-ink">{{ provider }}</span></span>
      <span>шагов <span class="ml-1 font-medium text-ink">{{ steps }}</span></span>
      <span>событий <span class="ml-1 font-medium text-ink">{{ trace.length }}</span></span>
    </div>

    <div
      v-if="trace.length === 0"
      class="mt-6 rounded-[2rem] border border-line bg-surface p-8 text-center shadow-[0_20px_40px_-15px_rgba(24,24,27,0.06)]"
    >
      <svg class="mx-auto h-14 w-16" viewBox="0 0 64 56" fill="none" aria-hidden="true">
        <path d="M4 10h24M4 20h16M4 30h28" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round" />
        <rect x="34" y="8" width="26" height="16" rx="5" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2" />
        <rect x="24" y="32" width="30" height="16" rx="5" fill="#FFFFFF" stroke="#94A3B8" stroke-width="2" />
        <path d="M39 16h7" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" />
        <path d="M31 40h15" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" />
      </svg>
      <p class="mt-4 font-medium">Шаги агента появятся здесь</p>
      <p class="mt-1 text-sm text-secondary">
        Отправьте сообщение в чате — вы увидите вызовы инструментов и результаты.
      </p>
    </div>

    <ol v-else class="mt-6 space-y-3">
      <li
        v-for="(entry, index) in trace"
        :key="`${entry.at}-${index}`"
        class="rise rounded-2xl border border-line bg-surface p-4"
        :style="{ '--delay': `${index * 45}ms` }"
      >
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span class="text-muted">шаг {{ entry.step }}</span>
          <span class="rounded-full px-2 py-0.5" :class="badges[entry.kind].style">
            {{ badges[entry.kind].label }}
          </span>
          <span v-if="entry.name" class="text-accent">{{ entry.name }}</span>
          <span class="ml-auto text-muted">
            {{ new Date(entry.at).toLocaleTimeString("ru-RU") }}
          </span>
        </div>
        <pre class="mt-3 max-h-44 overflow-auto rounded-xl bg-canvas p-3 font-mono text-[11px] leading-relaxed text-secondary">{{ entry.detail }}</pre>
      </li>
    </ol>
  </section>
</template>
