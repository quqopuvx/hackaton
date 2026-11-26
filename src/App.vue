<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { domain } from "../config/domain";
import { institutionTypeLabels } from "../lib/institution-types";
import { responseStatusLabels, type Institution, type InstitutionDetails, type InstitutionEdits, type InstitutionRefreshResult, type SearchEvent, type SearchResult } from "../lib/types";
import { readLines } from "../lib/read-lines";
import InstitutionEditor from "./components/InstitutionEditor.vue";
import ItemsPanel from "./components/ItemsPanel.vue";
import SchoolMailPage from "./components/SchoolMailPage.vue";
import { schoolMailLimit } from "../lib/school-mail";
import MailAnalytics from "./components/MailAnalytics.vue";
import RegistryMap from "./components/RegistryMap.vue";
import { regionByCode, registryRegionCode } from "./regions";

const query = ref("");
const searchInput = ref<HTMLInputElement>();
const busy = ref(false);
const loadingRegistry = ref(true);
const searchError = ref("");
const registryError = ref("");
const submittedQuery = ref("");
const results = ref<SearchResult | null>(null);
const previews = ref<Array<InstitutionDetails & { checkingContacts: boolean }>>([]);
const registry = ref<Institution[]>([]);
const mailSelection = ref(new Set<string>());
const mailSelectionLocked = ref(false);
const mailComposeRequest = ref(0);
const mailSchools = computed(() => registry.value.filter((item) => mailSelection.value.has(item.id)));

function toggleMail(id: string): void {
  if (mailSelectionLocked.value) return;
  if (mailSelection.value.has(id)) mailSelection.value.delete(id);
  else if (mailSelection.value.size < schoolMailLimit) mailSelection.value.add(id);
}

function resetMail(): void {
  mailSelectionLocked.value = false;
  mailSelection.value.clear();
}
const pagePaths = { results: "/", registry: "/registry", mail: "/mail", analytics: "/analytics" } as const;
type Page = keyof typeof pagePaths;

function currentPage(): Page {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === pagePaths.analytics) return "analytics";
  if (path === pagePaths.mail) return "mail";
  if (path === pagePaths.registry) return "registry";
  return "results";
}

const tab = ref<Page>(currentPage());
const tabPanel = ref<HTMLElement>();

function syncPage(): void {
  tab.value = currentPage();
}

function navigate(event: MouseEvent, page: Page, openComposer = false): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (openComposer) mailComposeRequest.value++;
  goToPage(page);
}

function goToPage(page: Page): void {
  if (tab.value === page) return;
  window.history.pushState(null, "", pagePaths[page]);
  syncPage();
}
const registryOrder = ref<"asc" | "desc">("asc");
const selectedRegion = ref("");
const registryQuery = ref("");
const selectedCity = ref("");
const selectedType = ref("");
const selectedStatus = ref("");
const selectedEmail = ref<"" | "present" | "missing">("");
const editing = ref<Institution>();
const savingEdit = ref(false);
const editError = ref("");
const editNotice = ref("");
const rowUpdates = ref<Record<string, { pending?: boolean; message?: string; error?: boolean }>>({});
const alphabet = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const filterInputClass = "min-h-11 w-full min-w-0 rounded-xl border border-line bg-canvas px-3 text-base text-ink focus-visible:outline-accent sm:text-sm";

function filterText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").trim();
}

const registryGroups = computed(() => {
  const groups = new Map<string, { code: string; region: string; items: Institution[] }>();
  for (const item of registry.value) {
    const code = registryRegionCode(item.region);
    const group = groups.get(code);
    if (group) group.items.push(item);
    else groups.set(code, { code, region: regionByCode.get(code)?.name ?? item.region.trim(), items: [item] });
  }
  const order = registryOrder.value === "asc" ? 1 : -1;
  const ordered = [...groups.values()].sort((left, right) => order * alphabet.compare(left.region, right.region));
  for (const group of ordered) {
    group.items.sort((left, right) => order * alphabet.compare(left.name, right.name) || alphabet.compare(left.city, right.city));
  }
  return ordered;
});
const regionCounts = computed(() => new Map(registryGroups.value.map((group) => [group.code, group.items.length])));
const otherRegions = computed(() => registryGroups.value.filter((group) => !regionByCode.has(group.code)));
const cities = computed(() => {
  const names = new Map<string, string>();
  for (const item of registry.value) names.set(filterText(item.city), item.city);
  if (selectedCity.value) names.set(filterText(selectedCity.value), selectedCity.value);
  return [...names.values()].sort(alphabet.compare);
});
const filtersActive = computed(() =>
  Boolean(registryQuery.value.trim() || selectedRegion.value || selectedCity.value || selectedType.value || selectedStatus.value || selectedEmail.value),
);
const visibleRegistryGroups = computed(() => {
  const terms = filterText(registryQuery.value).split(/\s+/).filter(Boolean);
  const city = filterText(selectedCity.value);
  return registryGroups.value.flatMap((group) => {
    if (selectedRegion.value && group.code !== selectedRegion.value) return [];
    const items = group.items.filter((item) => {
      if (city && filterText(item.city) !== city) return false;
      if (selectedType.value && (item.institutionType ?? "unknown") !== selectedType.value) return false;
      if (selectedStatus.value && item.responseStatus !== selectedStatus.value) return false;
      if (selectedEmail.value && Boolean(item.institutionEmail?.trim()) !== (selectedEmail.value === "present")) return false;
      if (!terms.length) return true;
      const text = filterText([
        item.name, item.city, item.region, group.region, item.leaderName, item.institutionEmail, item.institutionPhone,
      ].join(" "));
      return terms.every((term) => text.includes(term));
    });
    return items.length ? [{ ...group, items }] : [];
  });
});
const visibleRegistryCount = computed(() => visibleRegistryGroups.value.reduce((count, group) => count + group.items.length, 0));
const rows = computed(() => results.value?.institutions ?? previews.value);
const placeholders = computed(() => tab.value === "results" && busy.value && !results.value && !searchError.value
  ? Math.max(1, 3 - previews.value.length) : 0);
const centerSearch = computed(() => !busy.value && !rows.value.length);
let registryRequest = 0;

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

async function refreshRegistry(): Promise<void> {
  const request = ++registryRequest;
  loadingRegistry.value = true;
  registryError.value = "";
  try {
    const data = await readResponse<{ institutions: Institution[] }>(await fetch("/api/institutions"));
    if (request === registryRequest) registry.value = data.institutions;
  } catch (error) {
    if (request === registryRequest) {
      registryError.value = error instanceof Error ? error.message : "Не удалось загрузить реестр.";
    }
  } finally {
    if (request === registryRequest) loadingRegistry.value = false;
  }
}

function resetRegistryFilters(): void {
  registryQuery.value = "";
  selectedRegion.value = "";
  selectedCity.value = "";
  selectedType.value = "";
  selectedStatus.value = "";
  selectedEmail.value = "";
}

async function openRegistry(filters: {
  status?: Institution["responseStatus"];
  region?: string;
  email?: "present" | "missing";
}): Promise<void> {
  resetRegistryFilters();
  selectedStatus.value = filters.status ?? "";
  selectedRegion.value = filters.region ?? "";
  selectedEmail.value = filters.email ?? "";
  goToPage("registry");
  await nextTick();
  tabPanel.value?.focus();
}

function editInstitution(id: string): void {
  editing.value = registry.value.find((item) => item.id === id);
  editError.value = "";
  editNotice.value = "";
}

function replaceInstitution(institution: Institution): void {
  const replace = (row: Institution) => row.id === institution.id ? institution : row;
  registry.value = registry.value.map(replace);
  if (results.value) results.value.institutions = results.value.institutions.map(replace);
  void refreshRegistry();
}

async function refreshRegistryInstitution(id: string): Promise<void> {
  if (rowUpdates.value[id]?.pending) return;
  rowUpdates.value[id] = { pending: true };
  try {
    const { institution, status } = await readResponse<InstitutionRefreshResult>(await fetch(
      `/api/institutions/${id}/refresh`, { method: "POST" },
    ));
    replaceInstitution(institution);
    const messages = {
      updated: "Данные обновлены.",
      unchanged: "Новых сведений нет.",
      not_verified: "Не удалось подтвердить сведения об учреждении.",
    };
    rowUpdates.value[id] = { message: messages[status] };
  } catch (error) {
    rowUpdates.value[id] = {
      error: true,
      message: error instanceof Error ? error.message : "Не удалось обновить сведения.",
    };
  }
}

async function saveInstitution(edits: InstitutionEdits): Promise<void> {
  if (!editing.value || savingEdit.value) return;
  const id = editing.value.id;
  savingEdit.value = true;
  editError.value = "";
  try {
    const { institution } = await readResponse<{ institution: Institution }>(await fetch(`/api/institutions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edits),
    }));
    replaceInstitution(institution);
    editing.value = undefined;
    editNotice.value = "Изменения сохранены.";
  } catch (error) {
    editError.value = error instanceof Error ? error.message : "Не удалось сохранить изменения.";
  } finally {
    savingEdit.value = false;
  }
}

function clearSearch(): void {
  if (busy.value) return;
  query.value = "";
  submittedQuery.value = "";
  searchError.value = "";
  results.value = null;
  searchInput.value?.focus();
}

async function search(prompt = query.value): Promise<void> {
  const value = prompt.trim();
  if (!value || busy.value) return;
  query.value = value;
  submittedQuery.value = value;
  searchError.value = "";
  results.value = null;
  previews.value = [];
  busy.value = true;
  tabPanel.value?.scrollTo({ top: 0 });
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ query: value }),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
      results.value = await readResponse<SearchResult>(response);
    } else {
      if (!response.body) throw new Error("Сервер вернул пустой поток результатов.");
      for await (const line of readLines(response.body)) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as SearchEvent;
        if (event.type === "institution") {
          const item = event.institution;
          const index = previews.value.findIndex((row) => row.name === item.name && row.city === item.city && row.region === item.region);
          const preview = { ...item, checkingContacts: event.checkingContacts };
          if (index === -1) previews.value.push(preview);
          else previews.value[index] = preview;
        }
        else if (event.type === "error") throw new Error(event.message);
        else if (event.type === "complete") {
          results.value = event.result;
          break;
        }
      }
      if (!results.value) throw new Error("Поток результатов прервался. Повторите поиск.");
    }
    previews.value = [];
    await refreshRegistry();
  } catch (error) {
    previews.value = [];
    searchError.value = error instanceof Error ? error.message : "Не удалось выполнить поиск.";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  window.addEventListener("popstate", syncPage);
  void refreshRegistry();
});
onUnmounted(() => window.removeEventListener("popstate", syncPage));
</script>

<template>
  <main class="mx-auto flex h-svh min-h-[24rem] w-full max-w-[1400px] flex-col px-3 pt-5 pb-3 text-ink sm:px-6 sm:pt-8 sm:pb-5 lg:px-8 xl:px-10">
    <header class="mb-4 sm:mb-6">
      <h1 class="text-2xl font-semibold tracking-tight sm:text-4xl">{{ domain.caseTitle }}</h1>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">{{ domain.caseDescription }}</p>
    </header>

    <nav class="grid shrink-0 grid-cols-4 border-b border-line sm:flex sm:gap-3" aria-label="Разделы приложения">
      <a
        id="results-tab"
        :href="pagePaths.results"
        :aria-current="tab === 'results' ? 'page' : undefined"
        class="flex min-h-11 min-w-0 items-center justify-center border-b-2 px-2 py-1 text-center text-sm font-semibold sm:px-3"
        :class="tab === 'results' ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="navigate($event, 'results')"
      >Результаты поиска</a>
      <a
        id="registry-tab"
        :href="pagePaths.registry"
        :aria-current="tab === 'registry' ? 'page' : undefined"
        class="flex min-h-11 min-w-0 items-center justify-center border-b-2 px-2 py-1 text-center text-sm font-semibold sm:px-3"
        :class="tab === 'registry' ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="navigate($event, 'registry')"
      >Весь реестр<span v-if="registry.length">&nbsp;({{ registry.length }})</span></a>
      <a id="mail-tab" :href="pagePaths.mail" :aria-current="tab === 'mail' ? 'page' : undefined"
        class="flex min-h-11 items-center justify-center border-b-2 px-2 py-1 text-sm font-semibold sm:px-3"
        :class="tab === 'mail' ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="navigate($event, 'mail')">Почта</a>
      <a id="analytics-tab" :href="pagePaths.analytics" :aria-current="tab === 'analytics' ? 'page' : undefined"
        class="flex min-h-11 min-w-0 items-center justify-center border-b-2 px-2 py-1 text-center text-sm font-semibold [overflow-wrap:anywhere] sm:px-3"
        :class="tab === 'analytics' ? 'border-accent text-accent' : 'border-transparent text-secondary'"
        @click="navigate($event, 'analytics')">Аналитика</a>
    </nav>

    <section v-if="tab !== 'mail'" :key="tab" ref="tabPanel" :aria-labelledby="`${tab}-tab`" tabindex="0"
      class="min-h-0 w-full min-w-0 flex-1 overflow-y-auto pt-4 pb-5 [scrollbar-gutter:stable] focus-visible:outline-accent sm:pt-5"
      :class="{ 'search-panel': tab === 'results' }">
      <template v-if="tab === 'results'">
        <div class="search-layout mx-auto w-full max-w-3xl" :class="{ 'search-layout--centered': centerSearch }">
          <form role="search" aria-label="Поиск учреждений" @submit.prevent="search()">
            <label for="search-query" class="sr-only">Поиск учреждений</label>
            <div class="flex min-h-14 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1.5 pl-4 shadow-sm
              focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 sm:pl-5">
              <span aria-hidden="true" class="search-icon shrink-0 text-secondary"></span>
              <input
                id="search-query"
                ref="searchInput"
                v-model="query"
                type="search"
                autocomplete="off"
                enterkeyhint="search"
                required
                maxlength="400"
                placeholder="Найти учреждения"
                class="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              <button v-if="(query || submittedQuery) && !busy" type="button" aria-label="Очистить поиск"
                class="grid size-11 shrink-0 place-items-center rounded-full text-xl text-secondary hover:bg-canvas hover:text-ink focus-visible:outline-accent"
                @click="clearSearch"><span aria-hidden="true">×</span></button>
              <button type="submit" :disabled="busy || !query.trim()"
                class="min-h-11 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-white
                  focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-50 sm:px-6">
                {{ busy ? "Ищу…" : "Найти" }}
              </button>
            </div>
            <div v-if="centerSearch" class="mt-4 flex flex-wrap justify-center gap-2">
              <button
                v-for="prompt in domain.starterPrompts"
                :key="prompt"
                type="button"
                class="min-h-11 max-w-full rounded-full border border-line bg-surface px-4 py-2 text-xs text-secondary
                  hover:border-accent hover:text-accent focus-visible:outline-accent"
                @click="search(prompt)"
              >{{ prompt }}</button>
            </div>
          </form>
          <div class="text-sm text-secondary" :class="{ 'text-center': centerSearch }" aria-live="polite">
            <p v-if="searchError" role="alert" class="mt-4 text-danger">{{ searchError }}</p>
            <p v-else-if="busy && !results" class="mt-4">
              {{ rows.length ? "Найдено: " + rows.length + ". Поиск продолжается…" : "Ищу учреждения и проверяю источники…" }}
            </p>
            <p v-else-if="results && !rows.length" class="mt-4 [overflow-wrap:anywhere]">
              По запросу «{{ submittedQuery }}» ничего не найдено.
            </p>
            <p v-else-if="results" class="mt-4">
              {{ results.cached ? "Из сохранённой выдачи" : "Сохранено в реестре" }} · {{ rows.length }}
              <span v-if="results.partial"> · Часть источников не удалось обработать. Поиск можно повторить.</span>
            </p>
          </div>
        </div>
        <ItemsPanel v-if="rows.length || placeholders" :items="rows" :placeholders="placeholders" />
      </template>
      <div v-else-if="tab === 'registry' || registryError || !registry.length" class="text-sm text-secondary" aria-live="polite">
        <p v-if="registryError" role="alert" class="text-danger">{{ registryError }}</p>
        <button v-if="registryError && tab === 'analytics'" type="button" class="min-h-11 font-semibold text-accent"
          @click="refreshRegistry">Повторить загрузку</button>
        <p v-if="loadingRegistry && !registry.length">Загружаю реестр…</p>
        <p v-else-if="!registryError && !registry.length">В реестре пока нет учреждений.</p>
      </div>
      <MailAnalytics v-if="tab === 'analytics' && registry.length && !registryError" :groups="registryGroups"
        @open-registry="openRegistry" />
      <RegistryMap v-if="tab === 'registry' && (!loadingRegistry || registry.length) && !registryError"
        v-model="selectedRegion" :counts="regionCounts" :other-regions="otherRegions" :total="registry.length" />
      <div v-if="tab === 'registry' && registry.length" class="mt-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary sm:col-span-2 xl:col-span-1">
            Поиск по реестру
            <input v-model="registryQuery" type="search" placeholder="Название или контакт" :class="filterInputClass" />
          </label>
          <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
            Город
            <select v-model="selectedCity" :class="filterInputClass">
              <option value="">Все города</option>
              <option v-for="city in cities" :key="city" :value="city">{{ city }}</option>
            </select>
          </label>
          <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
            Тип учреждения
            <select v-model="selectedType" :class="filterInputClass">
              <option value="">Все типы</option>
              <option value="unknown">Не указан</option>
              <option v-for="(label, value) in institutionTypeLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
            Статус ответа
            <select v-model="selectedStatus" :class="filterInputClass">
              <option value="">Все статусы</option>
              <option v-for="(label, value) in responseStatusLabels" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
            Почта
            <select v-model="selectedEmail" :class="filterInputClass">
              <option value="">Все учреждения</option>
              <option value="present">С почтой</option>
              <option value="missing">Без почты</option>
            </select>
          </label>
          <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
            Алфавитный порядок
            <select v-model="registryOrder" :class="filterInputClass">
              <option value="asc">А–Я</option>
              <option value="desc">Я–А</option>
            </select>
          </label>
        </div>
        <div class="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-secondary">
          <p aria-live="polite">Показано {{ visibleRegistryCount }} из {{ registry.length }}</p>
          <a v-if="mailSelection.size" :href="pagePaths.mail" class="inline-flex min-h-11 items-center font-medium text-accent"
            @click="navigate($event, 'mail', true)">К письмам ({{ mailSelection.size }})</a>
          <button v-if="filtersActive" type="button" class="min-h-11 text-sm font-medium text-accent"
            @click="resetRegistryFilters">Сбросить фильтры</button>
        </div>
      </div>
      <p v-if="tab === 'registry' && editNotice" role="status" class="mt-4 text-sm font-medium text-accent">{{ editNotice }}</p>
      <p v-if="tab === 'registry' && filtersActive && !visibleRegistryCount && !loadingRegistry && !registryError"
        class="mt-5 rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-secondary" aria-live="polite">
        По выбранным фильтрам учреждения не найдены.
      </p>
      <div v-if="tab === 'registry' && visibleRegistryGroups.length" class="mt-5">
        <section v-for="group in visibleRegistryGroups" :key="group.code" class="mt-6">
          <h2 class="text-lg font-semibold [overflow-wrap:anywhere]">
            {{ group.region }} <span class="ml-1 text-sm font-normal text-secondary">· {{ group.items.length }}</span>
          </h2>
          <ItemsPanel :items="group.items" :placeholders="0" :show-region="false" :row-updates="rowUpdates" editable
            :mail-selection="mailSelection"
            :mail-selection-locked="mailSelectionLocked"
            @toggle-mail="toggleMail" @edit="editInstitution" @refresh="refreshRegistryInstitution" />
        </section>
      </div>
    </section>
    <SchoolMailPage v-show="tab === 'mail'" :institutions="registry" :selected="mailSelection"
      :selected-schools="mailSchools" :locked="mailSelectionLocked" :loading="loadingRegistry" :error="registryError" :active="tab === 'mail'"
      :compose-request="mailComposeRequest"
      @toggle="toggleMail" @lock="mailSelectionLocked = true" @reset="resetMail" @sent="refreshRegistry" />
    <InstitutionEditor v-if="editing" :key="editing.id" :institution="editing" :saving="savingEdit" :error="editError"
      @close="editing = undefined" @save="saveInstitution" />
  </main>
</template>

<style scoped>
.search-panel {
  container-type: size;
}

.search-layout {
  padding-block-start: 0;
}

.search-layout--centered {
  padding-block-start: max(0px, calc(100cqh - 50svh + 0.75rem));
}

@media (prefers-reduced-motion: no-preference) {
  .search-layout {
    transition: padding-block-start 320ms cubic-bezier(0.22, 1, 0.36, 1);
  }
}

.search-icon {
  position: relative;
  width: 0.9rem;
  height: 0.9rem;
  margin-right: 0.25rem;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  transform: translateY(-1px);
}

.search-icon::after {
  position: absolute;
  top: 100%;
  left: 80%;
  width: 0.4rem;
  height: 1.5px;
  border-radius: 1px;
  background: currentColor;
  content: "";
  transform: rotate(45deg);
  transform-origin: left center;
}
</style>
