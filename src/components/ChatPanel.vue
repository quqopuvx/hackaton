<script setup lang="ts">
import { domain } from "../../config/domain";
import type { UiMessage } from "../../lib/types";

defineProps<{
  messages: UiMessage[];
  busy: boolean;
  error: string;
  input: string;
}>();

const emit = defineEmits<{
  "update:input": [value: string];
  send: [prompt?: string];
}>();

function onInput(event: Event): void {
  emit("update:input", (event.target as HTMLTextAreaElement).value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    emit("send");
  }
}
</script>

<template>
  <section class="mx-auto max-w-4xl">
    <div class="mb-6 flex flex-wrap gap-2">
      <button
        v-for="(prompt, index) in domain.starterPrompts"
        :key="prompt"
        type="button"
        :disabled="busy"
        class="rise min-h-11 rounded-full border border-line bg-surface px-4 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        :style="{ '--delay': `${index * 50}ms` }"
        @click="emit('send', prompt)"
      >
        {{ prompt }}
      </button>
    </div>

    <div
      class="space-y-4 overflow-y-auto rounded-[2rem] border border-line bg-surface p-5 shadow-[0_20px_40px_-15px_rgba(24,24,27,0.06)] sm:p-6"
      style="max-height: min(56vh, 600px)"
    >
      <div
        v-for="(message, index) in messages"
        :key="message.id"
        class="rise flex"
        :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        :style="{ '--delay': `${index * 60}ms` }"
      >
        <div
          class="max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed"
          :class="
            message.role === 'user'
              ? 'rounded-br-sm bg-accent text-white'
              : 'rounded-bl-sm border border-line bg-canvas text-ink'
          "
        >
          <div v-if="message.pending" class="w-64 max-w-full space-y-2" aria-label="Агент думает">
            <div class="skeleton h-3 w-4/5" />
            <div class="skeleton h-3 w-full" />
            <div class="skeleton h-3 w-2/3" />
          </div>
          <template v-else>{{ message.content }}</template>
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-[2rem] border border-line bg-surface p-4 sm:p-5">
      <label for="agent-input" class="font-mono text-[11px] uppercase tracking-widest text-muted">
        Сообщение агенту
      </label>
      <div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
        <textarea
          id="agent-input"
          :value="input"
          rows="2"
          placeholder="Например: посчитай 12 * (7 + 3)"
          class="min-h-[72px] flex-1 resize-none rounded-2xl border border-line bg-canvas px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          @input="onInput"
          @keydown="onKeydown"
        />
        <button
          type="button"
          :disabled="busy || !input.trim()"
          class="min-h-11 shrink-0 rounded-2xl bg-accent px-6 text-sm font-medium text-white transition-transform active:-translate-y-px disabled:bg-slate-200 disabled:text-muted"
          @click="emit('send')"
        >
          {{ busy ? 'Отправка' : 'Отправить' }}
        </button>
      </div>
      <p class="mt-3 font-mono text-[11px] text-muted">
        Enter — отправить · Shift+Enter — новая строка
      </p>
    </div>
  </section>
</template>
