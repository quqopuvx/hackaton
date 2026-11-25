import { domain } from "../../config/domain.ts";
import type { ChatMessage, ToolCall } from "../types.ts";
import type { AgentTool } from "./tools.ts";

export interface ProviderReply {
  content: string;
  toolCalls: ToolCall[];
}

export interface AiProvider {
  name: string;
  chat(messages: ChatMessage[], tools: AgentTool[]): Promise<ProviderReply>;
}

const noCalls: ToolCall[] = [];

/** Работает без интернета и ключей: поведение агента можно проверить сразу. */
function mockProvider(): AiProvider {
  return {
    name: "mock (офлайн)",
    async chat(messages) {
      const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      const lower = lastUser.toLowerCase();
      const toolResults = messages.filter((message) => message.role === "tool");

      if (toolResults.length > 0) {
        const summary = toolResults
          .slice(-3)
          .map((message) => `• ${message.name ?? "инструмент"}: ${message.content}`)
          .join("\n");
        return {
          content: `Готово. Что вернули инструменты:\n\n${summary}\n\nМогу развить идею, добавить ${domain.entity.singular} или посчитать ещё что-то.`,
          toolCalls: noCalls,
        };
      }

      const call = (name: string, args: Record<string, unknown>): ProviderReply => ({
        content: "",
        toolCalls: [{ id: crypto.randomUUID(), name, arguments: args }],
      });

      const after = (phrases: string[]): string => {
        for (const phrase of phrases) {
          const index = lower.indexOf(phrase);
          if (index >= 0) {
            return lastUser
              .slice(index + phrase.length)
              .trim()
              .replace(/^[:—\-–]\s*/, "");
          }
        }
        return "";
      };

      if (/(посчитай|считай|calc)/.test(lower)) {
        return call("calculator", { expression: after(["посчитай", "считай", "calc"]) || "2+2" });
      }
      if (/(создай|добавь|add item|create)/.test(lower)) {
        return call("add_item", {
          title: after(["создай", "добавь", "add item", "create"]) || `Новая ${domain.entity.singular}`,
        });
      }
      if (/(покажи|список|все |list)/.test(lower)) {
        return call("list_items", {});
      }
      if (/(найди|поиск|search)/.test(lower)) {
        return call("mock_search", { query: after(["найди", "поиск", "search"]) || lastUser });
      }

      return {
        content: [
          `Я — демонстрационный агент **${domain.productName}**. Кейс: ${domain.caseTitle}.`,
          "",
          `Умею: считать, создавать и показывать «${domain.entity.plural}», делать демо-поиск.`,
          "Примеры: «Посчитай 12 * (7 + 3)», «Создай задачу: подготовить демо», «Покажи все задачи».",
          "",
          "Чтобы подключить реальную модель, задайте AI_PROVIDER и ключ в .env.local.",
        ].join("\n"),
        toolCalls: noCalls,
      };
    },
  };
}

interface OpenAICompatOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsTools: boolean;
  extraHeaders?: Record<string, string>;
}

type OpenAIMessage = Record<string, unknown>;

function toOpenAIMessage(message: ChatMessage): OpenAIMessage {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId ?? "unknown", content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || "",
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function openAICompatible(options: OpenAICompatOptions): AiProvider {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    name: options.name,
    async chat(messages, tools) {
      const payload: Record<string, unknown> = {
        model: options.model,
        messages: messages.map(toOpenAIMessage),
        temperature: 0.4,
      };
      if (options.supportsTools && tools.length > 0) {
        payload.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        payload.tool_choice = "auto";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
          ...options.extraHeaders,
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      if (!response.ok) throw new Error(`${options.name}: HTTP ${response.status} ${text.slice(0, 500)}`);

      let data: {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }> };
        }>;
      };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`${options.name}: не удалось разобрать JSON-ответ`);
      }

      const message = data.choices?.[0]?.message;
      if (!message) throw new Error(`${options.name}: пустой ответ модели`);

      const toolCalls: ToolCall[] = [];
      for (const item of message.tool_calls ?? []) {
        const name = item.function?.name;
        if (!name) continue;
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(item.function?.arguments || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
        toolCalls.push({ id: item.id ?? crypto.randomUUID(), name, arguments: args });
      }

      return { content: message.content ?? "", toolCalls };
    },
  };
}

function yandexProvider(): AiProvider {
  const folderId = required("YANDEX_FOLDER_ID");
  const apiKey = required("YANDEX_API_KEY");
  const model = process.env.YANDEX_MODEL || "yandexgpt";

  return {
    name: "YandexGPT (без tools)",
    async chat(messages) {
      const payload = {
        modelUri: `gpt://${folderId}/${model}/latest`,
        completionOptions: { stream: false, temperature: 0.4 },
        messages: messages
          .filter((message) => message.role !== "tool")
          .map((message) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            text: message.content,
          })),
      };

      const response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Api-Key ${apiKey}` },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`YandexGPT: HTTP ${response.status} ${text.slice(0, 500)}`);

      const data = JSON.parse(text) as {
        result?: { alternatives?: Array<{ message?: { text?: string } }> };
      };
      return { content: data.result?.alternatives?.[0]?.message?.text ?? "", toolCalls: noCalls };
    },
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Не задан ${name}. Добавьте его в .env.local (см. .env.example)`);
  return value;
}

export function getProvider(): AiProvider {
  const kind = (process.env.AI_PROVIDER || "mock").toLowerCase();
  const supportsTools = process.env.AI_SUPPORTS_TOOLS !== "0";

  switch (kind) {
    case "mock":
      return mockProvider();
    case "openai":
    case "openai-compatible":
      return openAICompatible({
        name: "OpenAI-compatible",
        baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        apiKey: required("OPENAI_API_KEY"),
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        supportsTools,
      });
    case "gigachat":
      return openAICompatible({
        name: "GigaChat",
        baseUrl: process.env.GIGACHAT_BASE_URL || "https://gigachat.devices.sberbank.ru/api/v1",
        apiKey: required("GIGACHAT_API_KEY"),
        model: process.env.GIGACHAT_MODEL || "GigaChat-2",
        supportsTools,
      });
    case "yandex":
      return yandexProvider();
    default:
      throw new Error(`Неизвестный AI_PROVIDER="${kind}". Возможные значения: mock, openai, gigachat, yandex`);
  }
}
