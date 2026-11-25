import { domain } from "../../config/domain.ts";
import { addItem, listItems, setItemStatus } from "../store.ts";

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  execute: (args: Record<string, unknown>) => string | Promise<string>;
}

/** Безопасный калькулятор без eval: только число, скобки и + - * /. */
function calculate(raw: string): number {
  const source = raw
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/,/g, ".");

  if (!source || !/^[0-9+\-*/().]+$/.test(source)) {
    throw new Error("Поддерживаются только числа, скобки и операции + - * /");
  }

  let index = 0;
  const peek = () => source[index];

  const parseNumber = (): number => {
    let buffer = "";
    while (index < source.length && /[0-9.]/.test(source[index])) {
      buffer += source[index];
      index += 1;
    }
    if (!buffer) throw new Error(`Ожидалось число в позиции ${index}`);
    const value = Number(buffer);
    if (!Number.isFinite(value)) throw new Error("Некорректное число");
    return value;
  };

  const parseFactor = (): number => {
    if (peek() === "+") {
      index += 1;
      return parseFactor();
    }
    if (peek() === "-") {
      index += 1;
      return -parseFactor();
    }
    if (peek() === "(") {
      index += 1;
      const value = parseExpression();
      if (peek() !== ")") throw new Error("Не закрыта скобка");
      index += 1;
      return value;
    }
    return parseNumber();
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = source[index];
      index += 1;
      const next = parseFactor();
      if (op === "/" && next === 0) throw new Error("Деление на ноль");
      value = op === "*" ? value * next : value / next;
    }
    return value;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = source[index];
      index += 1;
      const next = parseTerm();
      value = op === "+" ? value + next : value - next;
    }
    return value;
  };

  const result = parseExpression();
  if (index !== source.length) throw new Error(`Неожиданный символ в позиции ${index}`);
  return Math.round(result * 1e6) / 1e6;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Нужен строковый аргумент «${key}»`);
  }
  return value.trim();
}

export const tools: AgentTool[] = [
  {
    name: "calculator",
    description: "Безопасно считает арифметическое выражение. Пример: 12 * (7 + 3)",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Выражение, например 2+2*3" },
      },
      required: ["expression"],
    },
    execute: (args) => {
      const expression = stringArg(args, "expression");
      return String(calculate(expression));
    },
  },
  {
    name: "add_item",
    description: `Создаёт новую сущность «${domain.entity.singular}» в демо-базе.`,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Название" },
      },
      required: ["title"],
    },
    execute: (args) => {
      const item = addItem(stringArg(args, "title"));
      return `Создано: ${item.id} — ${item.title} (статус: new)`;
    },
  },
  {
    name: "list_items",
    description: `Возвращает все сущности «${domain.entity.plural}».`,
    parameters: { type: "object", properties: {}, required: [] },
    execute: () => {
      const all = listItems();
      if (all.length === 0) return "Список пуст.";
      return all
        .map((item) => `${item.id.slice(0, 8)} | ${item.status} | ${item.title}`)
        .join("\n");
    },
  },
  {
    name: "set_item_status",
    description: "Меняет статус сущности по id: new, in_progress или done.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "id из list_items (можно первые 8 символов)" },
        status: {
          type: "string",
          description: "Новый статус",
          enum: ["new", "in_progress", "done"],
        },
      },
      required: ["id", "status"],
    },
    execute: (args) => {
      const rawId = stringArg(args, "id");
      const status = stringArg(args, "status") as "new" | "in_progress" | "done";
      if (!["new", "in_progress", "done"].includes(status)) {
        throw new Error("Статус должен быть new, in_progress или done");
      }
      const item = listItems().find((candidate) => candidate.id.startsWith(rawId));
      if (!item) throw new Error(`Сущность с id «${rawId}» не найдена`);
      setItemStatus(item.id, status);
      return `Обновлено: ${item.title} → ${status}`;
    },
  },
  {
    name: "mock_search",
    description:
      "Демо-поиск по внутренним заметкам. Вернитесь к реальному поиску/RAG, когда появится кейс.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос" },
      },
      required: ["query"],
    },
    execute: (args) => {
      const query = stringArg(args, "query");
      return [
        `Результаты демо-поиска по запросу «${query}» (кейс: ${domain.caseTitle}):`,
        "1. Проблема пользователя: рутинные действия занимают слишком много времени.",
        "2. Гипотеза: агент с инструментами закрывает рутину за один диалог.",
        "3. Метрика: время до результата и доля задач без участия человека.",
        "Это заглушка: подключите свой поиск, векторную БД или API.",
      ].join("\n");
    },
  },
  {
    name: "current_time",
    description: "Возвращает текущие дату и время в ISO-формате.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: () => new Date().toISOString(),
  },
];

export const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
