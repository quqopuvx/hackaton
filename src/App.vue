<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { domain } from "../config/domain";
import type { Item, TraceEntry, UiMessage } from "../lib/types";
import ChatPanel from "./components/ChatPanel.vue";
import ItemsPanel from "./components/ItemsPanel.vue";
import TracePanel from "./components/TracePanel.vue";

type Tab = "chat" | "data" | "trace";

const chatAnchor = ref<HTMLElement | null>(null);
const busy = ref(false);
const error = ref("");
const input = ref("");
const items = ref<Item[]>([]);
const messages = ref<UiMessage[]>([
  {
    id: "welcome",
    role: "assistant",
    content: `Привет! Я агент прототипа «${domain.productName}». Спросите меня что-нибудь или выберите быстрый промпт ниже.`,
  },
]);
const provider = ref("загрузка…");
const steps = ref(0);
const tab = ref<Tab>("chat");
const trace = ref<TraceEntry[]>([]);

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "chat", label: "Чат с агентом" },
  { id: "data", label: `Данные: ${domain.entity.plural}` },
  { id: "trace", label: "Трассировка" },
];

async function refreshItems(): Promise<void> {
  const response = await fetch("/api/items");
  if (!response.ok) return;
  const data = (await response.json()) as { items: Item[] };
  items.value = data.items;
}

async function refreshInfo(): Promise<void> {
  const response = await fetch("/api/health");
  if (!response.ok) return;
  const data = (await response.json()) as { provider: string };
  provider.value = data.provider;
}

async function scrollToEnd(): Promise<void> {
  await nextTick();
  chatAnchor.value?.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function send(prompt?: string): Promise<void> {
  const text = (prompt ?? input.value).trim();
  if (!text || busy.value) return;

  input.value = "";
  error.value = "";
  messages.value.push({ id: crypto.randomUUID(), role: "user", content: text });

  const placeholder: UiMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    pending: true,
  };
  messages.value.push(placeholder);
  busy.value = true;

  try {
    const history = messages.value
      .filter((message) => !message.pending)
      .map((message) => ({ role: message.role, content: message.content }));

    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = (await response.json()) as {
      messages?: Array<{ content: string }>;
      trace?: TraceEntry[];
      provider?: string;
      steps?: number;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

    const target = messages.value.find((message) => message.id === placeholder.id);
    if (target) {
      target.content = (data.messages ?? []).map((message) => message.content).join("\n\n");
      target.pending = false;
    }
    trace.value = data.trace ?? [];
    steps.value = data.steps ?? 0;
    if (data.provider) provider.value = data.provider;
    await refreshItems();
  } catch (cause) {
    const target = messages.value.find((message) => message.id === placeholder.id);
    if (target) {
      target.pending = false;
      target.content = cause instanceof Error ? `Ошибка: ${cause.message}` : String(cause);
    }
    error.value = "Проверьте AI_PROVIDER и ключ в .env.local, затем перезапустите сервер.";
  } finally {
    busy.value = false;
    await scrollToEnd();
  }
}

onMounted(() => {
  void refreshItems();
  void refreshInfo();
});
</script>

<template>
  <div class="min-h-dvh bg-canvas text-ink">
    <div class="mx-auto grid max-w-[1400px] lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside
        class="flex flex-col border-b border-line bg-surface px-5 py-5 lg:min-h-dvh lg:border-b-0 lg:border-r lg:px-6 lg:py-8"
      >
        <div class="flex items-center gap-3">
          <div
            class="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-base font-semibold text-white"
          >
            A
          </div>
          <div>
            <p class="font-semibold tracking-[-0.02em]">{{ domain.productName }}</p>
            <p class="font-mono text-[11px] uppercase tracking-widest text-muted">hackathon kit</p>
          </div>
        </div>

        <div class="mt-9 hidden lg:block">
          <p class="font-mono text-[11px] uppercase tracking-widest text-muted">Роли в команде</p>
          <ul class="mt-4 space-y-3">
            <li
              v-for="(role, index) in domain.teamRoles"
              :key="role"
              class="rise flex items-center gap-3 text-sm text-secondary"
              :style="{ '--delay': `${index * 70}ms` }"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-accent" />
              {{ role }}
            </li>
          </ul>
        </div>

        <div class="mt-8 lg:mt-auto">
          <div class="rounded-2xl border border-line bg-canvas p-4">
            <p class="font-mono text-[11px] uppercase tracking-widest text-muted">Провайдер LLM</p>
            <p class="mt-2 flex items-center gap-2 text-sm font-medium">
              <span
                class="inline-flex h-2 w-2 items-center justify-center rounded-full text-accent"
                :class="busy ? 'pulse-ring' : ''"
              />
              <span class="truncate font-mono text-[13px]">{{ provider }}</span>
            </p>
          </div>
          <p class="mt-4 hidden text-xs leading-relaxed text-muted lg:block">
            Ключи читаются только сервером. Правила внешнего вида — в
            <code class="font-mono text-[11px] text-secondary">.stitch/DESIGN.md</code>.
          </p>
        </div>
      </aside>

      <main class="min-w-0">
        <header class="border-b border-line px-5 pb-8 pt-7 sm:px-9 lg:pt-12">
          <p class="font-mono text-[11px] uppercase tracking-[0.24em] text-secondary">
            Хакатон · прототип агента
          </p>
          <h1
            class="mt-3 font-semibold leading-[1.1] tracking-[-0.03em]"
            :style="{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)' }"
          >
            {{ domain.caseTitle }}
          </h1>
          <p class="mt-5 max-w-2xl text-sm leading-relaxed text-secondary">
            {{ domain.caseDescription }}
          </p>
        </header>

        <nav
          class="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-canvas/95 px-4 backdrop-blur sm:px-9"
        >
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            class="min-h-11 whitespace-nowrap border-b-2 px-3 text-sm transition-colors"
            :class="
              tab === item.id
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-muted hover:text-ink'
            "
            @click="tab = item.id"
          >
            {{ item.label }}
          </button>
        </nav>

        <div class="px-4 py-7 sm:px-9">
          <div
            v-if="error"
            class="mb-6 rounded-2xl border border-danger/30 bg-rose-50 px-4 py-3 text-sm text-danger"
          >
            {{ error }}
          </div>

          <ChatPanel
            v-if="tab === 'chat'"
            :messages="messages"
            :busy="busy"
            :error="error"
            :input="input"
            @update:input="input = $event"
            @send="send"
          />
          <ItemsPanel v-else-if="tab === 'data'" :items="items" @changed="refreshItems" />
          <TracePanel v-else :trace="trace" :provider="provider" :steps="steps" />
        </div>

        <footer class="border-t border-line px-5 py-5 sm:px-9">
          <p class="font-mono text-[11px] text-muted">
            Agent Lab · дизайн по стандарту taste-design
          </p>
        </footer>

        <div ref="chatAnchor" class="h-px" />
      </main>
    </div>
  </div>
</template>
