<script setup lang="ts">
import { computed } from "vue";
import { responseStatusLabels, type Institution } from "../../lib/types";

type ResponseStatus = Institution["responseStatus"];
type RegistryGroup = { code: string; region: string; items: Institution[] };
type RegistryFilters = { status?: ResponseStatus; region?: string; email?: "present" | "missing" };

const props = defineProps<{ groups: RegistryGroup[] }>();
const emit = defineEmits<{ "open-registry": [filters: RegistryFilters] }>();

function summarize(items: Institution[]) {
  const counts = { not_sent: 0, awaiting_reply: 0, replied: 0 };
  let withEmail = 0;
  let ready = 0;
  for (const item of items) {
    counts[item.responseStatus] += 1;
    if (!item.institutionEmail?.trim()) continue;
    withEmail += 1;
    if (item.responseStatus === "not_sent") ready += 1;
  }
  return { total: items.length, counts, withEmail, ready };
}

const overall = computed(() => summarize(props.groups.flatMap((group) => group.items)));
const regions = computed(() => props.groups.map(({ code, region, items }) => ({
  code, region, ...summarize(items),
})).sort((a, b) => b.total - a.total || a.region.localeCompare(b.region, "ru")));
const statuses = [
  { key: "not_sent", color: "bg-slate-400" },
  { key: "awaiting_reply", color: "bg-amber-500" },
  { key: "replied", color: "bg-emerald-600" },
] as const;
const missing = computed(() => overall.value.total - overall.value.withEmail);
const contacted = computed(() => overall.value.counts.awaiting_reply + overall.value.counts.replied);
const number = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });
const cards = computed<Array<{ label: string; value: number; detail: string; filters: RegistryFilters }>>(() => [
  {
    label: "Учреждения с почтой",
    value: overall.value.withEmail,
    detail: `${percent.format(overall.value.withEmail / overall.value.total)} от всего реестра`,
    filters: { email: "present" },
  },
  {
    label: "Можно написать",
    value: overall.value.ready,
    detail: "Есть адрес, письмо ещё не отправлено",
    filters: { status: "not_sent", email: "present" },
  },
  {
    label: "Ожидают ответа",
    value: overall.value.counts.awaiting_reply,
    detail: "Письмо отмечено как отправленное",
    filters: { status: "awaiting_reply" },
  },
  {
    label: "Ответили",
    value: overall.value.counts.replied,
    detail: contacted.value
      ? `${percent.format(overall.value.counts.replied / contacted.value)} от учреждений, которым написали`
      : "Отправленных писем пока нет",
    filters: { status: "replied" },
  },
]);
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
      <div>
        <h2 class="text-xl font-extrabold text-accent sm:text-2xl">Аналитика переписки</h2>
        <p class="mt-1 text-sm text-secondary">Статусы и почтовые контакты по всему реестру</p>
      </div>
      <button type="button" class="min-h-11 text-sm font-medium text-accent underline-offset-4 hover:underline"
        @click="emit('open-registry', {})">Открыть реестр</button>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button v-for="card in cards" :key="card.label" type="button"
        class="flex min-w-0 flex-col items-start rounded-ui border border-line bg-surface p-4 text-left transition-colors enabled:hover:border-accent enabled:hover:bg-accent-soft focus-visible:outline-accent sm:p-5"
        :disabled="!card.value" @click="emit('open-registry', card.filters)">
        <span class="text-sm font-semibold">{{ card.label }}</span>
        <span class="my-1.5 text-3xl font-semibold tracking-tight tabular-nums">{{ number.format(card.value) }}</span>
        <span class="text-sm text-secondary">{{ card.detail }}</span>
      </button>
    </div>

    <div class="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="mail-status-title" class="rounded-ui border border-line bg-surface p-4 sm:p-5">
        <h3 id="mail-status-title" class="font-semibold">Статусы переписки</h3>
        <p class="mt-1 text-sm text-secondary">Всего учреждений · {{ number.format(overall.total) }}</p>
        <ul class="mt-2 grid gap-1">
          <li v-for="{ key, color } in statuses" :key="key">
            <button type="button" class="block min-h-11 w-full rounded-ui text-left enabled:hover:text-accent focus-visible:outline-accent"
              :disabled="!overall.counts[key]" @click="emit('open-registry', { status: key })">
              <span class="flex items-baseline justify-between gap-4 text-sm">
                <span>{{ responseStatusLabels[key] }}</span>
                <span class="shrink-0 tabular-nums text-secondary">
                  {{ number.format(overall.counts[key]) }} · {{ percent.format(overall.counts[key] / overall.total) }}
                </span>
              </span>
              <span aria-hidden="true" class="mt-1 block h-2 overflow-hidden rounded-ui bg-accent-soft">
                <span class="block h-full rounded-ui" :class="color"
                  :style="{ width: `${100 * overall.counts[key] / overall.total}%` }" />
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section aria-labelledby="mail-contacts-title" class="flex flex-col items-start rounded-ui border border-line bg-surface p-4 sm:p-5">
        <h3 id="mail-contacts-title" class="font-semibold">Учреждения без почты</h3>
        <p class="mt-2 text-3xl font-semibold tabular-nums">{{ number.format(missing) }}</p>
        <p class="mt-2 text-sm text-secondary">
          {{ missing ? "Добавьте адрес в карточке учреждения, чтобы использовать его для переписки." : "Почта указана у всех учреждений." }}
        </p>
        <button v-if="missing" type="button" class="mt-auto min-h-11 text-sm font-semibold text-accent underline-offset-4 hover:underline"
          @click="emit('open-registry', { email: 'missing' })">Показать учреждения без почты</button>
      </section>
    </div>

    <section aria-labelledby="mail-regions-title" class="rounded-ui border border-line bg-surface">
      <h3 id="mail-regions-title" class="px-4 py-4 font-semibold sm:px-5">Переписка по регионам</h3>
      <div class="overflow-x-auto" tabindex="0" aria-labelledby="mail-regions-title">
        <table class="w-full text-left text-sm">
          <thead class="border-y border-line bg-canvas text-xs text-secondary">
            <tr>
              <th scope="col" class="px-4 py-3 sm:px-5">Регион</th>
              <th scope="col" class="px-3 py-3 text-right">Всего</th>
              <th scope="col" class="px-3 py-3 text-right">С почтой</th>
              <th scope="col" class="px-3 py-3 text-right">Не отправлено</th>
              <th scope="col" class="px-3 py-3 text-right">Ждут ответа</th>
              <th scope="col" class="px-3 py-3 pr-4 text-right sm:pr-5">Ответили</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="region in regions" :key="region.code">
              <th scope="row" class="px-4 sm:px-5">
                <button type="button" class="min-h-11 min-w-32 py-2 text-left font-semibold text-accent underline-offset-4 hover:underline"
                  @click="emit('open-registry', { region: region.code })">{{ region.region }}</button>
              </th>
              <td class="px-3 py-2 text-right tabular-nums">{{ number.format(region.total) }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ number.format(region.withEmail) }}</td>
              <td v-for="{ key } in statuses" :key="key" class="px-3 py-2 text-right tabular-nums last:pr-4 sm:last:pr-5">
                {{ number.format(region.counts[key]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
