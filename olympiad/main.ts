import { olympiad, type OlympiadSchool } from "../lib/olympiad.ts";
import "../src/style.css";
import "./style.css";

const registration = document.querySelector<HTMLFormElement>("#registration-form")!;
const errorMessage = document.querySelector<HTMLParagraphElement>("#registration-error")!;
const submit = registration.querySelector<HTMLButtonElement>("button[type=submit]")!;
const schoolSearch = document.querySelector<HTMLInputElement>("#school-search")!;
const schoolSelect = document.querySelector<HTMLSelectElement>("#school")!;
const schoolStatus = document.querySelector<HTMLParagraphElement>("#school-status")!;
const retrySchools = document.querySelector<HTMLButtonElement>("#retry-schools")!;
const dialog = document.querySelector<HTMLDialogElement>("#consent-dialog")!;
const registrationPanel = document.querySelector<HTMLElement>("#registration")!;
const catalog = document.querySelector<HTMLElement>("#catalog")!;
const quiz = document.querySelector<HTMLFormElement>("#quiz-form")!;
const details = [...document.querySelectorAll<HTMLElement>("main .detail")];
const filters = [...document.querySelectorAll<HTMLButtonElement>("[data-filter]")];
const cards = document.querySelectorAll<HTMLElement>("[data-category]");
const registrationKey = `mercury-olympiad-registered-${olympiad.consentVersion}`;
let registered = false;
let submitting = false;
let schools: Array<{ id: string; label: string; searchText: string }> = [];

document.querySelector("#open-consent")!.addEventListener("click", () => dialog.showModal());

function schoolSearchText(value: string): string {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function renderSchools(): void {
  const selected = schoolSelect.value;
  const query = schoolSearchText(schoolSearch.value);
  const words = query ? query.split(" ") : [];
  const matches = schools.filter((school) => words.every((word) => school.searchText.includes(word)));
  const options = document.createDocumentFragment();
  options.append(new Option("Выбери свою школу", ""));
  for (const school of matches) options.append(new Option(school.label, school.id));
  schoolSelect.replaceChildren(options);
  schoolSelect.value = matches.some((school) => school.id === selected) ? selected : "";
  schoolSelect.disabled = !matches.length;
  submit.disabled = submitting || !matches.length;
  schoolStatus.textContent = !schools.length ? "В реестре пока нет школ."
    : matches.length ? `Школ в списке: ${matches.length}.` : "Школы по этому запросу не найдены.";
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
    schoolSearch.disabled = !schools.length;
    renderSchools();
  } catch {
    schoolStatus.textContent = "Не удалось загрузить школы. Попробуй ещё раз.";
    retrySchools.hidden = false;
  }
}

schoolSearch.addEventListener("input", renderSchools);
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
  if (focus) catalog.querySelector("h1")?.focus();
}

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
  if (submit.disabled || !schoolSelect.value) return;
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
    submit.disabled = schoolSelect.disabled;
    submit.textContent = "Зарегистрироваться";
  }
});
