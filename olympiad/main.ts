import { olympiad, type OlympiadSchool } from "../lib/olympiad.ts";
import "../src/style.css";
import "./style.css";

const registration = document.querySelector<HTMLFormElement>("#registration-form")!;
const errorMessage = document.querySelector<HTMLParagraphElement>("#registration-error")!;
const submit = registration.querySelector<HTMLButtonElement>("button[type=submit]")!;
const schoolPicker = document.querySelector<HTMLElement>("#school-picker")!;
const schoolTrigger = document.querySelector<HTMLButtonElement>("#school")!;
const schoolLabel = document.querySelector<HTMLElement>("#school-label")!;
const schoolValue = document.querySelector<HTMLInputElement>("#school-value")!;
const schoolPopup = document.querySelector<HTMLElement>("#school-popup")!;
const schoolSearch = document.querySelector<HTMLInputElement>("#school-search")!;
const schoolOptions = document.querySelector<HTMLUListElement>("#school-options")!;
const schoolEmpty = document.querySelector<HTMLElement>("#school-empty")!;
const schoolStatus = document.querySelector<HTMLParagraphElement>("#school-status")!;
const retrySchools = document.querySelector<HTMLButtonElement>("#retry-schools")!;
const dialog = document.querySelector<HTMLDialogElement>("#consent-dialog")!;
const registrationPanel = document.querySelector<HTMLElement>("#registration")!;
const catalog = document.querySelector<HTMLElement>("#catalog")!;
const logout = document.querySelector<HTMLButtonElement>("#logout")!;
const quiz = document.querySelector<HTMLFormElement>("#quiz-form")!;
const details = [...document.querySelectorAll<HTMLElement>("main .detail")];
const filters = [...document.querySelectorAll<HTMLButtonElement>("[data-filter]")];
const cards = document.querySelectorAll<HTMLElement>("[data-category]");
const registrationKey = `mercury-olympiad-registered-${olympiad.consentVersion}`;
let registered = false;
let submitting = false;
let schools: Array<{ id: string; label: string; searchText: string }> = [];
let activeSchool = -1;

document.querySelector("#open-consent")!.addEventListener("click", () => dialog.showModal());

function schoolSearchText(value: string): string {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function highlightSchool(index: number, scroll = false): void {
  schoolOptions.children[activeSchool]?.removeAttribute("data-active");
  const option = schoolOptions.children[index];
  activeSchool = option ? index : -1;
  if (option) {
    option.setAttribute("data-active", "");
    schoolSearch.setAttribute("aria-activedescendant", option.id);
    if (scroll) option.scrollIntoView({ block: "nearest" });
  } else {
    schoolSearch.removeAttribute("aria-activedescendant");
  }
}

function renderSchools(): void {
  const query = schoolSearchText(schoolSearch.value);
  const words = query ? query.split(" ") : [];
  const matches = schools.filter((school) => words.every((word) => school.searchText.includes(word)));
  const options = document.createDocumentFragment();
  for (const school of matches) {
    const option = document.createElement("li");
    option.id = `school-option-${school.id}`;
    option.dataset.schoolId = school.id;
    option.textContent = school.label;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(school.id === schoolValue.value));
    options.append(option);
  }
  schoolOptions.replaceChildren(options);
  schoolOptions.scrollTop = 0;
  schoolEmpty.hidden = !!matches.length;
  highlightSchool(query ? 0 : Math.max(0, matches.findIndex((school) => school.id === schoolValue.value)));
}

function closeSchoolPicker(restoreFocus = false): void {
  schoolPopup.hidden = true;
  schoolTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) schoolTrigger.focus();
}

function openSchoolPicker(): void {
  schoolSearch.value = "";
  schoolPopup.hidden = false;
  schoolTrigger.setAttribute("aria-expanded", "true");
  renderSchools();
  schoolSearch.focus();
  highlightSchool(activeSchool, true);
}

function chooseSchool(option: HTMLElement): void {
  schoolValue.value = option.dataset.schoolId!;
  schoolLabel.textContent = option.textContent;
  if (schoolTrigger.hasAttribute("aria-invalid")) {
    schoolTrigger.removeAttribute("aria-invalid");
    schoolTrigger.removeAttribute("aria-describedby");
    errorMessage.hidden = true;
  }
  closeSchoolPicker(true);
}

async function loadSchools(): Promise<void> {
  schoolStatus.textContent = "Загружаю школы из реестра…";
  retrySchools.hidden = true;
  try {
    const response = await fetch("/api/olympiad/schools");
    if (!response.ok) throw new Error();
    const data: { schools: OlympiadSchool[] } = await response.json();
    schools = data.schools.map(({ id, name, city, region }) => {
      const label = [name, city, region].filter(Boolean).join(" · ");
      return { id, label, searchText: schoolSearchText(label) };
    });
    schoolTrigger.disabled = !schools.length;
    submit.disabled = !schools.length;
    schoolStatus.hidden = !!schools.length;
    schoolStatus.textContent = "В реестре пока нет школ.";
  } catch {
    schoolStatus.textContent = "Не удалось загрузить школы. Попробуй ещё раз.";
    retrySchools.hidden = false;
  }
}

schoolTrigger.addEventListener("click", () => {
  if (schoolPopup.hidden) openSchoolPicker();
  else closeSchoolPicker();
});
schoolTrigger.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && schoolPopup.hidden) {
    event.preventDefault();
    openSchoolPicker();
  }
});
schoolSearch.addEventListener("input", renderSchools);
schoolSearch.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  const count = schoolOptions.children.length;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSchoolPicker(true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const option = schoolOptions.children[activeSchool];
    if (option instanceof HTMLElement) chooseSchool(option);
  } else if (count && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    highlightSchool(Math.min(count - 1, Math.max(0, activeSchool + (event.key === "ArrowDown" ? 1 : -1))), true);
  }
});
schoolOptions.addEventListener("click", (event) => {
  const option = (event.target as HTMLElement).closest<HTMLElement>("[data-school-id]");
  if (option) chooseSchool(option);
});

function closeSchoolPickerOutside(event: Event): void {
  if (!schoolPopup.hidden && !schoolPicker.contains(event.target as Node)) closeSchoolPicker();
}

document.addEventListener("pointerdown", closeSchoolPickerOutside);
document.addEventListener("focusin", closeSchoolPickerOutside);
retrySchools.addEventListener("click", () => void loadSchools());

const questions = [
  { text: "Какое число продолжит последовательность 2, 6, 12, 20?", options: ["26", "30", "32"], correct: 1 },
  { text: "В коробке 3 красные и 2 синие карточки. Какова вероятность достать синюю?", options: ["1/2", "3/5", "2/5"], correct: 2 },
  { text: "Все участники команды решили первую задачу. Лена в команде. Что следует из этих условий?", options: ["Лена решила первую задачу", "Лена решила все задачи", "Лена решила задачу первой"], correct: 0 },
];

function buildQuiz() {
  questions.forEach((question, index) => {
    const field = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = `${index + 1}. ${question.text}`;
    field.append(legend);
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `question-${index}`;
      input.value = String(optionIndex);
      input.required = true;
      label.append(input, option);
      field.append(label);
    });
    quiz.append(field);
  });
  const check = document.createElement("button");
  check.className = "action action-primary";
  check.type = "submit";
  check.textContent = "Проверить ответы";
  quiz.append(check);
  quiz.addEventListener("submit", (event) => {
    event.preventDefault();
    const answers = new FormData(quiz);
    const score = questions.filter((question, index) => answers.get(`question-${index}`) === String(question.correct)).length;
    const result = document.querySelector<HTMLParagraphElement>("#quiz-result")!;
    result.textContent = `Верных ответов: ${score} из ${questions.length}.`;
    result.hidden = false;
  });
}

function showCatalog(focus = true) {
  registrationPanel.hidden = true;
  details.forEach((panel) => { panel.hidden = true; });
  catalog.hidden = false;
  logout.hidden = false;
  if (focus) catalog.querySelector("h1")?.focus();
}

logout.addEventListener("click", () => {
  try {
    sessionStorage.removeItem(registrationKey);
  } catch {
    // Registration access is kept only in the current page if browser storage is unavailable.
  }
  window.location.reload();
});

filters.forEach((button) => {
  button.addEventListener("click", () => {
    filters.forEach((filter) => filter.setAttribute("aria-pressed", String(filter === button)));
    cards.forEach((card) => {
      card.hidden = button.dataset.filter !== "all" && button.dataset.filter !== card.dataset.category;
    });
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!registered) return;
    const panel = details.find((detail) => detail.id === button.dataset.open);
    if (!panel) return;
    if (panel.id === "activity" && !quiz.childElementCount) buildQuiz();
    catalog.hidden = true;
    panel.hidden = false;
    panel.querySelector("h1")?.focus();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((button) => {
  button.addEventListener("click", () => showCatalog());
});

try {
  registered = sessionStorage.getItem(registrationKey) === "true";
} catch {
  // Registration still works in the current page when storage is unavailable.
}
if (registered) showCatalog(false);
else void loadSchools();

registration.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || submit.disabled) return;
  if (!schoolValue.value) {
    errorMessage.textContent = "Выбери свою школу.";
    errorMessage.hidden = false;
    schoolTrigger.setAttribute("aria-invalid", "true");
    schoolTrigger.setAttribute("aria-describedby", errorMessage.id);
    openSchoolPicker();
    return;
  }
  errorMessage.hidden = true;
  const values = new FormData(registration);
  submitting = true;
  submit.disabled = true;
  submit.textContent = "Отправляем…";
  try {
    const response = await fetch("/api/olympiad/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.get("name"),
        email: values.get("email"),
        schoolId: values.get("schoolId"),
        consent: values.has("consent"),
        consentVersion: olympiad.consentVersion,
        invitationOptIn: values.has("invitationOptIn"),
      }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      errorMessage.textContent = details.error || "Не удалось зарегистрироваться. Попробуй ещё раз.";
      errorMessage.hidden = false;
      return;
    }
    registered = true;
    try {
      sessionStorage.setItem(registrationKey, "true");
    } catch {
      // Only preserving access on reload depends on browser storage.
    }
    registration.reset();
    showCatalog();
  } catch {
    errorMessage.textContent = "Сервер недоступен. Попробуй ещё раз.";
    errorMessage.hidden = false;
  } finally {
    submitting = false;
    submit.disabled = schoolTrigger.disabled;
    submit.textContent = "Зарегистрироваться";
  }
});
