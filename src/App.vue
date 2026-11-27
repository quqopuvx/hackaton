<script setup lang="ts">
import { apiFetch } from "./session-api";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { domain } from "../config/domain";
import { institutionTypeLabels } from "../lib/institution-types";
import { responseStatusLabels, type Institution, type InstitutionDetails, type InstitutionEdits, type InstitutionRefreshResult, type SearchEvent, type SearchResult } from "../lib/types";
import { readLines } from "../lib/read-lines";
import InstitutionEditor from "./components/InstitutionEditor.vue";
import InstitutionDetailsDialog from "./components/InstitutionDetailsDialog.vue";
import ItemsPanel from "./components/ItemsPanel.vue";
import SchoolMailPage from "./components/SchoolMailPage.vue";
import SchoolMailTemplates from "./components/SchoolMailTemplates.vue";
import CampaignPage from "./components/CampaignPage.vue";
import type { CampaignMailPreset } from "../lib/campaigns";
import { isSingleEmail, schoolMailLimit, type SavedSchoolMailTemplate, type SchoolMailOutcome, type SchoolReply } from "../lib/school-mail";
import MailAnalytics from "./components/MailAnalytics.vue";
import RegistryMap from "./components/RegistryMap.vue";
import { regionByCode, registryRegionCode } from "./regions";
import SettingsPage from "./components/SettingsPage.vue";
import NotificationsPage from "./components/NotificationsPage.vue";
import { fetchSchoolReplies } from "./mail-replies";
import { readBrowserValue, readPreferences, saveBrowserValue, type AppNotification, type NotificationKind, type Preferences } from "./preferences";
import { accountRoleLabels, type Account } from "../lib/accounts";
import AuditPage from "./components/AuditPage.vue";

const props = defineProps<{ user: Account; signingOut: boolean; logoutError: string }>();
const emit = defineEmits<{ logout: [] }>();
const preferencesPrefix = "mercury." + props.user.username + ".";
const preferencesKey = preferencesPrefix + "preferences";

const query = ref("");
const searchInput = ref<HTMLInputElement>();
const searchWithEmail = ref(false);
const searchSelectionNotice = ref("");
const recipientsDialog = ref<HTMLDialogElement>();
const searchControls = ref<HTMLElement>();
const busy = ref(false);
const loadingRegistry = ref(true);
const searchError = ref("");
const registryError = ref("");
const submittedQuery = ref("");
const results = ref<SearchResult | null>(null);
const previews = ref<Array<InstitutionDetails & { checkingContacts: boolean }>>([]);
const registry = ref<Institution[]>([]);
const openedInstitution = ref<Institution>();
const mailSelection = ref(new Set<string>());
const selectedSearchRows = ref(new Map<string, Institution>());
const mailSelectionLocked = ref(false);
const mailComposeRequest = ref(0);
const campaignMail = ref<CampaignMailPreset>();
const mailInstitutions = computed(() => {
  const registryIds = new Set(registry.value.map(({ id }) => id));
  return [...registry.value, ...[...selectedSearchRows.value.values()].filter(({ id }) => !registryIds.has(id))];
});
const mailRecipients = computed(() => mailInstitutions.value.filter((item) => mailSelection.value.has(item.id)));

function removeMailRecipient(id: string): void {
  if (mailSelectionLocked.value) return;
  mailSelection.value.delete(id);
  selectedSearchRows.value.delete(id);
  searchSelectionNotice.value = "";
  if (!mailSelection.value.size && recipientsDialog.value?.open) {
    recipientsDialog.value.close();
    tabPanel.value?.focus({ preventScroll: true });
  }
}

function toggleMail(id: string): void {
  if (mailSelectionLocked.value) return;
  if (mailSelection.value.has(id)) {
    removeMailRecipient(id);
    return;
  }
  if (campaignMail.value && tab.value !== "mail") resetMail();
  if (mailSelection.value.size >= schoolMailLimit) return;
  const result = results.value?.institutions.find((item) => item.id === id);
  if (result) selectedSearchRows.value.set(id, result);
  mailSelection.value.add(id);
  searchSelectionNotice.value = "";
}

function resetMail(): void {
  searchSelectionNotice.value = "";
  mailSelectionLocked.value = false;
  mailSelection.value.clear();
  selectedSearchRows.value.clear();
  campaignMail.value = undefined;
}

function selectMailRecipients(ids: string[]): void {
  if (mailSelectionLocked.value) return;
  campaignMail.value = undefined;
  selectedSearchRows.value.clear();
  mailSelection.value = new Set(ids.slice(0, schoolMailLimit));
  void refreshRegistry();
}
const pagePaths = { results: "/", registry: "/registry", mail: "/mail", analytics: "/analytics", campaigns: "/campaigns", templates: "/templates", settings: "/settings", notifications: "/notifications", audit: "/audit" } as const;
type Page = keyof typeof pagePaths;

function currentPage(): Page {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === pagePaths.analytics) return "analytics";
  if (path === pagePaths.mail) return "mail";
  if (path === pagePaths.registry) return "registry";
  if (path === pagePaths.campaigns) return "campaigns";
  if (path === pagePaths.templates) return "templates";
  if (path === pagePaths.settings) return "settings";
  if (path === pagePaths.notifications) return "notifications";
  if (path === pagePaths.audit) {
    if (props.user.role === "admin") return "audit";
    window.history.replaceState(null, "", pagePaths.results);
  }
  return "results";
}

const tab = ref<Page>(currentPage());
watch(tab, () => { openedInstitution.value = undefined; });

function openInstitution(id: string): void {
  openedInstitution.value = registry.value.find((institution) => institution.id === id);
}
const tabPanel = ref<HTMLElement>();
const menuOpen = ref(false);
const profileMenu = ref<HTMLElement>();
const menuButton = ref<HTMLButtonElement>();
const profileLinks = { settings: "Настройки", templates: "Шаблоны", notifications: "Уведомления", audit: "Журнал аудита" } as const;
const visibleProfileLinks = props.user.role === "admin" ? profileLinks : {
  settings: profileLinks.settings, templates: profileLinks.templates, notifications: profileLinks.notifications,
};
const preferences = ref(readPreferences(preferencesKey));
const preferencesStorageError = ref(false);
const notificationsKey = preferencesPrefix + "notifications";
const seenRepliesKey = preferencesPrefix + "seen-replies";
const notifications = ref(readBrowserValue<AppNotification[]>(notificationsKey) ?? []);
let seenReplies = new Set(readBrowserValue<number[]>(seenRepliesKey) ?? []);
const checkingReplies = ref(false);
const replyError = ref("");

watch(() => preferences.value.theme, (theme, _, onCleanup) => {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme(): void {
    document.documentElement.dataset.theme = theme === "system" ? (system.matches ? "dark" : "light") : theme;
  }
  applyTheme();
  if (theme === "system") {
    system.addEventListener("change", applyTheme);
    onCleanup(() => system.removeEventListener("change", applyTheme));
  }
}, { immediate: true });

function savePreferences(next: Preferences): void {
  if (selectedRegion.value === preferences.value.defaultRegion) selectedRegion.value = next.defaultRegion;
  preferences.value = next;
  preferencesStorageError.value = !saveBrowserValue(preferencesKey, next);
}

function addNotifications(items: AppNotification[]): void {
  if (!items.length) return;
  const all = new Map(notifications.value.map((item) => [item.id, item]));
  for (const item of items) {
    if (preferences.value.notifications[item.kind]) all.set(item.id, item);
  }
  notifications.value = [...all.values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 100);
  saveBrowserValue(notificationsKey, notifications.value);
}

function recordReplies(replies: SchoolReply[]): void {
  if (!preferences.value.notifications.reply) return;
  addNotifications(replies.filter(({ id }) => !seenReplies.has(id)).map((reply) => ({
    id: "reply-" + reply.id,
    kind: "reply",
    text: reply.schoolName + " — " + (reply.subject || "Без темы"),
    date: reply.receivedAt,
  })));
  seenReplies = new Set([...new Set([...replies.map(({ id }) => id), ...seenReplies])].slice(0, 150));
  saveBrowserValue(seenRepliesKey, [...seenReplies]);
}

async function checkReplies(): Promise<void> {
  if (checkingReplies.value || !preferences.value.notifications.reply) return;
  checkingReplies.value = true;
  replyError.value = "";
  try {
    recordReplies(await fetchSchoolReplies());
  } catch (error) {
    replyError.value = error instanceof Error && error.name === "Error" ? error.message : "Не удалось загрузить ответы.";
  } finally {
    checkingReplies.value = false;
  }
}

watch([tab, () => preferences.value.notifications.reply], ([page, enabled], _, onCleanup) => {
  if (page !== "notifications" || !enabled) return;
  void checkReplies();
  const timer = window.setInterval(() => { if (!document.hidden) void checkReplies(); }, 60_000);
  onCleanup(() => window.clearInterval(timer));
}, { immediate: true });

function updateNotificationPreference(kind: NotificationKind, enabled: boolean): void {
  savePreferences({ ...preferences.value, notifications: { ...preferences.value.notifications, [kind]: enabled } });
}

function recordDelivery(requestId: string, outcomes: SchoolMailOutcome[]): void {
  if (!outcomes.length || outcomes.some(({ status }) => status === "sending")) return;
  const accepted = outcomes.filter(({ status }) => status === "sent").length;
  const date = new Date().toISOString();
  const items: AppNotification[] = [{
    id: "completed-" + requestId, kind: "completed", date,
    text: "Почтовый сервер принял " + accepted + " из " + outcomes.length + " писем.",
  }];
  if (accepted < outcomes.length) {
    const failed = outcomes.filter(({ status }) => status === "failed").length;
    const uncertain = outcomes.filter(({ status }) => status === "uncertain").length;
    const skipped = outcomes.filter(({ status }) => status === "skipped").length;
    const summary = [failed && "отклонено: " + failed, uncertain && "не подтверждено: " + uncertain, skipped && "пропущено: " + skipped];
    items.push({ id: "error-" + requestId, kind: "sendError", date, text: "Письма — " + summary.filter(Boolean).join(", ") + "." });
  }
  addNotifications(items);
}

function recordDeliveryError(requestId: string, message: string): void {
  addNotifications([{ id: "request-" + requestId, kind: "sendError", date: new Date().toISOString(), text: message }]);
}
const savedTemplates = ref<SavedSchoolMailTemplate[]>([]);
const templateError = ref("");
const templatesLoading = ref(false);
let templatesRequest = 0;

async function refreshTemplates(): Promise<void> {
  const request = ++templatesRequest;
  templatesLoading.value = true;
  templateError.value = "";
  try {
    const { templates } = await readResponse<{ templates: SavedSchoolMailTemplate[] }>(await apiFetch("/api/school-mail/templates"));
    if (request === templatesRequest) savedTemplates.value = templates;
  } catch {
    if (request === templatesRequest) templateError.value = "Не удалось загрузить сохранённые шаблоны.";
  } finally {
    if (request === templatesRequest) templatesLoading.value = false;
  }
}

watch(tab, (page) => {
  if (page === "mail" || page === "templates" || page === "settings") void refreshTemplates();
}, { immediate: true });

function updateTemplates(template: SavedSchoolMailTemplate): void {
  savedTemplates.value = [...savedTemplates.value.filter((item) => item.id !== template.id), template]
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  void refreshTemplates();
}

function removeTemplate(id: string): void {
  savedTemplates.value = savedTemplates.value.filter((item) => item.id !== id);
  if (preferences.value.defaultTemplate === id) savePreferences({ ...preferences.value, defaultTemplate: "" });
  void refreshTemplates();
}

function closeMenu(): void {
  menuOpen.value = false;
}

function toggleMenu(): void {
  if (menuOpen.value) closeMenu();
  else menuOpen.value = true;
}

function closeMenuOutside(event: Event): void {
  if (menuOpen.value && event.target instanceof Node && !profileMenu.value?.contains(event.target)) closeMenu();
}

function escapeMenu(event: KeyboardEvent): void {
  if (!menuOpen.value || event.key !== "Escape") return;
  event.preventDefault();
  closeMenu();
  menuButton.value?.focus();
}

async function openProfilePage(event: MouseEvent, page: keyof typeof profileLinks): Promise<void> {
  if (!navigate(event, page)) return;
  closeMenu();
  await nextTick();
  document.getElementById(page + "-title")?.focus();
}

function resetRecipientSelection(): void {
  if (mailSelectionLocked.value) return;
  resetMail();
  tabPanel.value?.focus({ preventScroll: true });
}

function setPanelInert(panel: Element, inert: boolean): void {
  panel.toggleAttribute("inert", inert);
}

function syncPage(): void {
  recipientsDialog.value?.close();
  closeMenu();
  tab.value = currentPage();
}

function navigate(event: MouseEvent, page: Page): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  goToPage(page);
  return true;
}

function goToPage(page: Page): void {
  if (tab.value === page) return;
  window.history.pushState(null, "", pagePaths[page]);
  syncPage();
}
let mailSource: "results" | "registry" = "registry";
let mailSourceScrollTop = 0;

function openMailComposer(): void {
  if (!mailSelection.value.size) return;
  if (tab.value === "results" || tab.value === "registry") {
    mailSource = tab.value;
    mailSourceScrollTop = tabPanel.value?.scrollTop ?? 0;
  }
  mailComposeRequest.value++;
  goToPage("mail");
}

async function returnToRecipients(): Promise<void> {
  if (mailSelectionLocked.value || campaignMail.value) return;
  goToPage(mailSource);
  await nextTick();
  tabPanel.value?.scrollTo({ top: mailSourceScrollTop });
  tabPanel.value?.focus({ preventScroll: true });
}

function openCampaignMail(preset: CampaignMailPreset): void {
  if (mailSelectionLocked.value) return;
  selectMailRecipients(preset.recipientIds);
  campaignMail.value = preset;
  openMailComposer();
}

function writeToInstitution(id: string): void {
  if (mailSelectionLocked.value || mailSelection.value.size) return;
  if (!mailSelection.value.has(id)) toggleMail(id);
  if (mailSelection.value.has(id)) openMailComposer();
}

type RegistryEmail = "" | "present" | "missing";
const filtersKey = preferencesPrefix + "registry-filters";
const initialFilters = preferences.value.rememberFilters
  ? readBrowserValue<{ region: string; query: string; city: string; type: string; status: string; email: RegistryEmail; order: "asc" | "desc" }>(filtersKey)
  : undefined;
const registryOrder = ref<"asc" | "desc">(initialFilters?.order ?? "asc");
const selectedRegion = ref(initialFilters?.region ?? preferences.value.defaultRegion);
const registryQuery = ref(initialFilters?.query ?? "");
const selectedCity = ref(initialFilters?.city ?? "");
const selectedType = ref(initialFilters?.type ?? "");
const selectedStatus = ref(initialFilters?.status ?? "");
const selectedEmail = ref<RegistryEmail>(initialFilters?.email ?? "");
watch([() => preferences.value.rememberFilters, selectedRegion, registryQuery, selectedCity, selectedType, selectedStatus, selectedEmail, registryOrder],
  ([remember, region, query, city, type, status, email, order]) => {
    saveBrowserValue(filtersKey, remember ? { region, query, city, type, status, email, order } : undefined);
  });
const editing = ref<Institution>();
const savingEdit = ref(false);
const editError = ref("");
const editNotice = ref("");
const rowUpdates = ref<Record<string, { pending?: boolean; message?: string; error?: boolean }>>({});
const alphabet = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

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
const visibleSearchRows = computed(() => searchWithEmail.value
  ? rows.value.filter(({ institutionEmail }) => isSingleEmail(institutionEmail?.trim() ?? ""))
  : rows.value);
const eligibleSearchRows = computed(() => (results.value?.institutions ?? []).filter(({ id, institutionEmail }) =>
  !mailSelection.value.has(id) && isSingleEmail(institutionEmail?.trim() ?? "")));
const remainingMailSlots = computed(() => schoolMailLimit - mailSelection.value.size);

function selectEligibleSearchRows(): void {
  if (mailSelectionLocked.value || campaignMail.value || !remainingMailSlots.value) return;
  const matches = eligibleSearchRows.value;
  const toAdd = matches.slice(0, remainingMailSlots.value);
  if (!toAdd.length) return;
  for (const { id } of toAdd) toggleMail(id);
  const remaining = matches.length - toAdd.length;
  searchSelectionNotice.value = remaining
    ? "Добавлены первые " + toAdd.length + " из " + matches.length + " подходящих. Достигнут лимит " + schoolMailLimit + "."
    : "Добавлено получателей: " + toAdd.length + ".";
}
const placeholders = computed(() => tab.value === "results" && busy.value && !results.value && !searchError.value
  ? Math.max(1, 3 - previews.value.length) : 0);
const centerSearch = computed(() => !query.value.trim() && !submittedQuery.value);
const searchGlows = Array.from({ length: 3 }, () => ({
  "--glow-duration": (24 + Math.random() * 12) + "s",
  "--glow-delay": -(Math.random() * 20) + "s",
  "--glow-x1": (Math.random() * 28 - 14) + "%",
  "--glow-y1": (Math.random() * 24 - 12) + "%",
  "--glow-x2": (Math.random() * 28 - 14) + "%",
  "--glow-y2": (Math.random() * 24 - 12) + "%",
}));
let searchPositionAnimation: Animation | undefined;

watch(centerSearch, async () => {
  const controls = searchControls.value;
  if (!controls || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const previousTop = controls.getBoundingClientRect().top;
  searchPositionAnimation?.cancel();
  await nextTick();
  if (searchControls.value !== controls) return;
  const distance = previousTop - controls.getBoundingClientRect().top;
  if (Math.abs(distance) < 1) return;
  searchPositionAnimation = controls.animate(
    [{ transform: "translateY(" + distance + "px)" }, { transform: "translateY(0)" }],
    { duration: 500, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
});

function pinLeavingSearchTable(element: Element): void {
  if (element instanceof HTMLElement) {
    element.style.setProperty("--search-table-top", element.offsetTop + "px");
  }
}
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
    const data = await readResponse<{ institutions: Institution[] }>(await apiFetch("/api/institutions"));
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
    const { institution, status } = await readResponse<InstitutionRefreshResult>(await apiFetch(
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
    const { institution } = await readResponse<{ institution: Institution }>(await apiFetch(`/api/institutions/${id}`, {
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
  searchWithEmail.value = false;
  searchSelectionNotice.value = "";
  submittedQuery.value = "";
  searchError.value = "";
  results.value = null;
  searchInput.value?.focus({ preventScroll: true });
}

async function search(prompt = query.value): Promise<void> {
  const value = prompt.trim();
  if (!value || busy.value) return;
  query.value = value;
  submittedQuery.value = value;
  searchSelectionNotice.value = "";
  searchError.value = "";
  results.value = null;
  previews.value = [];
  busy.value = true;
  tabPanel.value?.scrollTo({ top: 0 });
  try {
    const response = await apiFetch("/api/agent", {
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
  document.addEventListener("click", closeMenuOutside);
  document.addEventListener("focusin", closeMenuOutside);
  document.addEventListener("keydown", escapeMenu);
  void refreshRegistry();
});
onUnmounted(() => {
  window.removeEventListener("popstate", syncPage);
  document.removeEventListener("click", closeMenuOutside);
  document.removeEventListener("focusin", closeMenuOutside);
  document.removeEventListener("keydown", escapeMenu);
});
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <a class="brand" :href="pagePaths.results" @click="navigate($event, 'results')">
        <span aria-hidden="true" class="brand-mark"></span>
        {{ domain.caseTitle }}
      </a>
      <nav class="site-nav" aria-label="Разделы приложения">
        <a id="results-tab" :href="pagePaths.results"
          :aria-current="tab === 'results' ? 'page' : undefined"
          :class="{ 'nav-active': tab === 'results' }"
          @click="navigate($event, 'results')">Поиск</a>
        <a id="registry-tab" :href="pagePaths.registry"
          :aria-current="tab === 'registry' ? 'page' : undefined"
          :class="{ 'nav-active': tab === 'registry' }"
          @click="navigate($event, 'registry')">Реестр</a>
        <a id="analytics-tab" :href="pagePaths.analytics"
          :aria-current="tab === 'analytics' ? 'page' : undefined"
          :class="{ 'nav-active': tab === 'analytics' }"
          @click="navigate($event, 'analytics')">Аналитика</a>
        <a id="mail-tab" :href="pagePaths.mail"
          :aria-current="tab === 'mail' ? 'page' : undefined"
          :class="{ 'nav-active': tab === 'mail' }"
          @click="navigate($event, 'mail')">Почта</a>
        <a id="campaigns-tab" :href="pagePaths.campaigns"
          :aria-current="tab === 'campaigns' ? 'page' : undefined"
          :class="{ 'nav-active': tab === 'campaigns' }"
          @click="navigate($event, 'campaigns')">Кампании</a>
        <div ref="profileMenu" class="profile-menu">
          <button ref="menuButton" type="button" class="nav-menu" aria-label="Меню профиля"
            aria-controls="profile-menu" :aria-expanded="menuOpen" @click="toggleMenu">
            <span aria-hidden="true"></span>
          </button>
          <div v-show="menuOpen" id="profile-menu" class="profile-menu-panel">
            <div class="profile-menu-name">
              <p>{{ user.name }}</p>
              <p v-if="user.name !== accountRoleLabels[user.role]" class="text-xs font-normal text-secondary">{{ accountRoleLabels[user.role] }}</p>
            </div>
            <a v-for="(label, page) in visibleProfileLinks" :key="page" :href="pagePaths[page]" class="profile-menu-item"
              :aria-current="tab === page ? 'page' : undefined" @click="openProfilePage($event, page)">{{ label }}</a>
            <button type="button" class="profile-menu-item profile-menu-exit" :disabled="signingOut" @click="emit('logout')">
              {{ signingOut ? "Выхожу…" : "Выйти из аккаунта" }}
            </button>
            <p v-if="logoutError" role="alert" class="profile-menu-notice">{{ logoutError }}</p>
          </div>
        </div>
      </nav>
    </header>

    <main class="app-content">
      <Transition name="route-backdrop">
        <div v-if="tab === 'results'" class="search-backdrop" :class="{ 'search-backdrop--leaving': !centerSearch }" aria-hidden="true">
          <div v-for="(motion, index) in searchGlows" :key="index" class="search-glow" :style="motion">
            <span class="search-glow-circle"></span>
          </div>
        </div>
      </Transition>
      <Transition name="route-panel" @before-leave="setPanelInert($event, true)" @before-enter="setPanelInert($event, false)">
        <div v-if="tab === 'results' || tab === 'registry' || tab === 'analytics'" :key="tab" class="route-panel">
          <section ref="tabPanel" :aria-labelledby="`${tab}-tab`" tabindex="0"
            class="app-panel focus-visible:outline-accent"
            :class="{ 'search-panel': tab === 'results' }">
            <template v-if="tab === 'results'">
              <div class="search-layout" :class="{ 'search-layout--centered': centerSearch }">
                <form role="search" aria-label="Поиск учреждений" @submit.prevent="search()">
                  <h1 v-if="centerSearch" class="search-title">Что найти?</h1>
                  <label for="search-query" class="sr-only">Поиск учреждений</label>
                  <div ref="searchControls" class="search-controls">
                    <div class="search-field">
                      <input
                        id="search-query"
                        ref="searchInput"
                        v-model="query"
                        type="search"
                        autocomplete="off"
                        enterkeyhint="search"
                        required
                        maxlength="400"
                        placeholder="Например, художественные колледжи Красноярского края"
                        class="min-h-11 min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
                      />
                      <button v-if="(query || submittedQuery) && !busy" type="button" aria-label="Очистить поиск"
                        class="grid size-10 shrink-0 place-items-center rounded-ui text-xl text-secondary hover:text-accent"
                        @click="clearSearch"><span aria-hidden="true">×</span></button>
                    </div>
                    <button type="submit" :disabled="busy || !query.trim()" :aria-label="busy ? 'Ищу…' : 'Найти'"
                      class="search-submit">
                      <span aria-hidden="true" class="search-icon"></span>
                    </button>
                  </div>
                  <div v-if="centerSearch" class="search-prompts">
                    <button
                      v-for="prompt in domain.starterPrompts"
                      :key="prompt"
                      type="button"
                      class="search-prompt"
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
              <div v-if="results?.institutions.length" class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                <label class="flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">
                  <input v-model="searchWithEmail" type="checkbox" class="size-4 shrink-0 accent-accent" />
                  Только с почтой
                </label>
                <button type="button"
                  :disabled="mailSelectionLocked || !!campaignMail || !remainingMailSlots || !eligibleSearchRows.length"
                  class="min-h-11 rounded-ui border border-accent/35 px-3 text-sm font-bold text-accent
                    enabled:hover:bg-accent-soft focus-visible:outline-accent disabled:opacity-50"
                  @click="selectEligibleSearchRows">Выбрать подходящих</button>
                <p class="w-full text-sm text-secondary" role="status">
                  {{ searchSelectionNotice || (eligibleSearchRows.length > remainingMailSlots && remainingMailSlots && !campaignMail && !mailSelectionLocked
                    ? "Добавятся первые " + remainingMailSlots + " подходящих из " + eligibleSearchRows.length + "."
                    : "") }}
                </p>
              </div>
              <p v-if="searchWithEmail && rows.length && !visibleSearchRows.length" class="mt-3 pb-2 text-sm text-secondary" role="status">
                Среди найденных учреждений нет адресов для рассылки.
              </p>
              <Transition name="search-table" @before-leave="pinLeavingSearchTable">
                <ItemsPanel v-if="visibleSearchRows.length || placeholders" :items="visibleSearchRows" :placeholders="placeholders"
                  :mail-selection="mailSelection" :mail-selection-locked="mailSelectionLocked"
                  @toggle-mail="toggleMail" @write-mail="writeToInstitution" />
              </Transition>
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
            <div v-if="tab === 'registry' && registry.length" class="registry-filters">
              <div class="registry-filter-grid">
                <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
                  Поиск по реестру
                  <input v-model="registryQuery" type="search" placeholder="Название или контакт" />
                </label>
                <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
                  Город
                  <select v-model="selectedCity">
                    <option value="">Все города</option>
                    <option v-for="city in cities" :key="city" :value="city">{{ city }}</option>
                  </select>
                </label>
                <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
                  Тип учреждения
                  <select v-model="selectedType">
                    <option value="">Все типы</option>
                    <option value="unknown">Не указан</option>
                    <option v-for="(label, value) in institutionTypeLabels" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
                  Статус ответа
                  <select v-model="selectedStatus">
                    <option value="">Все статусы</option>
                    <option v-for="(label, value) in responseStatusLabels" :key="value" :value="value">{{ label }}</option>
                  </select>
                </label>
                <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
                  Почта
                  <select v-model="selectedEmail">
                    <option value="">Все учреждения</option>
                    <option value="present">С почтой</option>
                    <option value="missing">Без почты</option>
                  </select>
                </label>
                <label class="grid min-w-0 gap-1 text-xs font-medium text-secondary">
                  Алфавитный порядок
                  <select v-model="registryOrder">
                    <option value="asc">А–Я</option>
                    <option value="desc">Я–А</option>
                  </select>
                </label>
              </div>
              <div class="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-secondary">
                <p aria-live="polite">Показано {{ visibleRegistryCount }} из {{ registry.length }}</p>
                <button v-if="filtersActive" type="button" class="min-h-11 text-sm font-medium text-accent"
                  @click="resetRegistryFilters">Сбросить фильтры</button>
              </div>
            </div>
            <p v-if="tab === 'registry' && editNotice" role="status" class="mt-4 text-sm font-medium text-accent">{{ editNotice }}</p>
            <p v-if="tab === 'registry' && filtersActive && !visibleRegistryCount && !loadingRegistry && !registryError"
              class="mt-5 rounded-ui border border-line bg-surface px-5 py-4 text-sm text-secondary" aria-live="polite">
              По выбранным фильтрам учреждения не найдены.
            </p>
            <div v-if="tab === 'registry' && visibleRegistryGroups.length" class="mt-5">
              <section v-for="group in visibleRegistryGroups" :key="group.code" class="mt-6">
                <h2 class="registry-group-title">
                  {{ group.region }}
                  <span class="registry-group-count"><span class="sr-only">Учреждений: </span>{{ group.items.length }}</span>
                </h2>
                <ItemsPanel :items="group.items" :placeholders="0" :row-updates="rowUpdates" editable openable
                  :mail-selection="mailSelection"
                  :mail-selection-locked="mailSelectionLocked"
                  @open="openInstitution" @toggle-mail="toggleMail" @write-mail="writeToInstitution"
                  @edit="editInstitution" @refresh="refreshRegistryInstitution" />
              </section>
            </div>
          </section>
          <Transition v-if="tab === 'registry' || tab === 'results'" name="mail-action">
            <div v-if="mailSelection.size" class="mail-action-collapse">
              <div class="mail-action-inner">
                <div class="registry-mail-footer">
                  <button type="button" aria-haspopup="dialog" aria-controls="selected-recipients"
                    class="min-h-11 rounded-ui px-2 text-sm font-bold text-accent hover:bg-accent-soft focus-visible:outline-accent"
                    @click="recipientsDialog?.showModal()">
                    <span aria-live="polite">Выбрано: {{ mailSelection.size }} из {{ schoolMailLimit }}</span>
                  </button>
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" :disabled="mailSelectionLocked"
                      class="min-h-11 rounded-ui border border-accent/35 px-3 text-sm font-bold text-accent
                        transition-colors enabled:hover:bg-accent-soft focus-visible:outline-2
                        focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50
                        motion-reduce:transition-none"
                      @click="resetRecipientSelection">Сбросить выбор</button>
                    <button type="button" class="registry-mail-button" @click="openMailComposer">
                      {{ mailSelectionLocked ? "К рассылке" : "Подготовить письмо" }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
      <Transition name="route-panel" @before-leave="setPanelInert($event, true)" @before-enter="setPanelInert($event, false)">
        <div v-show="tab === 'mail'" class="route-panel">
          <SchoolMailPage :institutions="mailInstitutions" :selected="mailSelection"
            :selected-recipients="mailRecipients" :locked="mailSelectionLocked" :loading="loadingRegistry" :error="registryError" :active="tab === 'mail'"
            :compose-request="mailComposeRequest" :campaign-mail="campaignMail" :saved-templates="savedTemplates" :preferences="preferences"
            @replies="recordReplies" @delivery="recordDelivery" @delivery-error="recordDeliveryError" @template-saved="updateTemplates"
            @return-to-recipients="returnToRecipients" @toggle="toggleMail" @choose-recipients="selectMailRecipients" @lock="mailSelectionLocked = true"
            @unlock="mailSelectionLocked = false" @reset="resetMail" @sent="refreshRegistry" />
        </div>
      </Transition>
      <Transition name="route-panel" @before-leave="setPanelInert($event, true)" @before-enter="setPanelInert($event, false)">
        <div v-show="tab === 'templates'" class="route-panel">
          <section aria-labelledby="templates-title"
            class="min-h-0 w-full flex-1 overflow-y-auto pt-4 pb-5 [scrollbar-gutter:stable] sm:pt-5">
            <h2 id="templates-title" tabindex="-1"
              class="mb-4 text-xl font-extrabold text-accent sm:text-2xl">Шаблоны</h2>
            <SchoolMailTemplates :templates="savedTemplates" :loading="templatesLoading" :load-error="templateError"
              @saved="updateTemplates" @deleted="removeTemplate" />
          </section>
        </div>
      </Transition>
      <Transition name="route-panel" @before-leave="setPanelInert($event, true)" @before-enter="setPanelInert($event, false)">
        <div v-if="tab === 'settings' || tab === 'notifications' || tab === 'audit'" :key="tab" class="route-panel">
          <section :aria-labelledby="tab + '-title'"
            class="min-h-0 w-full flex-1 overflow-y-auto pt-4 pb-5 [scrollbar-gutter:stable] sm:pt-5">
            <h2 :id="tab + '-title'" tabindex="-1" class="mb-4 text-xl font-extrabold text-accent sm:text-2xl">{{ profileLinks[tab] }}</h2>
            <SettingsPage v-if="tab === 'settings'" :preferences="preferences" :templates="savedTemplates"
              :storage-error="preferencesStorageError" :can-manage-applicant-mail="user.role === 'admin'" @save="savePreferences" />
            <NotificationsPage v-else-if="tab === 'notifications'" :items="notifications" :enabled="preferences.notifications" :refreshing="checkingReplies"
              :error="replyError" @toggle="updateNotificationPreference" @refresh="checkReplies" />
            <AuditPage v-else-if="user.role === 'admin'" />
          </section>
        </div>
      </Transition>
      <Transition name="route-panel" @before-leave="setPanelInert($event, true)" @before-enter="setPanelInert($event, false)">
        <div v-show="tab === 'campaigns'" class="route-panel">
          <CampaignPage :active="tab === 'campaigns'" :mail-locked="mailSelectionLocked"
            @prepare-mail="openCampaignMail" />
        </div>
      </Transition>
      <dialog id="selected-recipients" ref="recipientsDialog" aria-labelledby="selected-recipients-title"
        class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto
          rounded-ui border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-slate-900/45 sm:p-7">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="selected-recipients-title" class="text-lg font-semibold">Выбранные получатели</h2>
          <button type="button" autofocus
            class="min-h-11 rounded-ui border border-line px-3 text-sm font-semibold text-accent focus-visible:outline-accent"
            @click="recipientsDialog?.close()">Закрыть</button>
        </div>
        <ul class="mt-3 divide-y divide-line">
          <li v-for="recipient in mailRecipients" :key="recipient.id"
            class="flex items-center justify-between gap-2 py-2 [overflow-wrap:anywhere]">
            <div class="min-w-0 text-sm">
              <p class="font-semibold">{{ recipient.name }}</p>
              <p class="text-secondary">{{ recipient.institutionEmail || "Нет адреса" }}</p>
            </div>
            <button type="button" :disabled="mailSelectionLocked" :aria-label="'Убрать из рассылки: ' + recipient.name"
              class="min-h-11 shrink-0 rounded-ui px-2 text-sm font-semibold text-accent
                enabled:hover:bg-accent-soft focus-visible:outline-accent disabled:opacity-50"
              @click="removeMailRecipient(recipient.id)">Убрать</button>
          </li>
        </ul>
        <p v-if="mailSelectionLocked" class="mt-3 text-sm text-secondary">Список зафиксирован для текущей рассылки.</p>
      </dialog>
      <InstitutionDetailsDialog v-if="openedInstitution" :key="openedInstitution.id" :institution="openedInstitution"
        @close="openedInstitution = undefined" />
      <InstitutionEditor v-if="editing" :key="editing.id" :institution="editing" :saving="savingEdit" :error="editError"
        @close="editing = undefined" @save="saveInstitution" />
    </main>
  </div>
</template>
