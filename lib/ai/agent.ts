import { domain } from "../../config/domain.ts";
import type { AgentResult, ChatMessage, TraceEntry } from "../types.ts";
import { getProvider } from "./providers.ts";
import { toolByName, tools } from "./tools.ts";

const now = () => new Date().toISOString();

/** Цикл «модель -> инструмент -> модель» с ограничением шагов и полной трассировкой. */
export async function runAgent(history: ChatMessage[]): Promise<AgentResult> {
  const provider = getProvider();
  const messages: ChatMessage[] = [{ role: "system", content: domain.systemPrompt }, ...history];
  const trace: TraceEntry[] = [];
  const answer: Array<{ role: "assistant"; content: string }> = [];

  const configured = Number(process.env.AGENT_MAX_STEPS ?? 5);
  const maxSteps = Number.isFinite(configured)
    ? Math.min(8, Math.max(1, Math.trunc(configured)))
    : 5;

  let steps = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    steps = step;
    const reply = await provider.chat(messages, tools);

    if (reply.content.trim()) {
      answer.push({ role: "assistant", content: reply.content });
      trace.push({
        step,
        kind: "text",
        detail: reply.content.slice(0, 400),
        at: now(),
      });
    }

    if (reply.toolCalls.length === 0) break;

    messages.push({ role: "assistant", content: reply.content || "", toolCalls: reply.toolCalls });

    for (const call of reply.toolCalls) {
      trace.push({
        step,
        kind: "call",
        name: call.name,
        detail: JSON.stringify(call.arguments).slice(0, 400),
        at: now(),
      });

      const tool = toolByName.get(call.name);
      let result: string;

      if (!tool) {
        result = `Неизвестный инструмент «${call.name}». Доступные: ${[...toolByName.keys()].join(", ")}`;
        trace.push({ step, kind: "error", name: call.name, detail: result, at: now() });
      } else {
        try {
          result = await tool.execute(call.arguments);
        } catch (error) {
          result = `Ошибка инструмента: ${error instanceof Error ? error.message : String(error)}`;
          trace.push({ step, kind: "error", name: call.name, detail: result, at: now() });
        }
      }

      messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: result });
      trace.push({ step, kind: "result", name: call.name, detail: result.slice(0, 600), at: now() });
    }

    if (step === maxSteps) {
      trace.push({
        step,
        kind: "error",
        detail: `Достигнут лимит шагов (${maxSteps}). Увеличьте AGENT_MAX_STEPS в .env.local.`,
        at: now(),
      });
    }
  }

  if (answer.length === 0) {
    answer.push({
      role: "assistant",
      content: "Готово. Модель не вернула текста — проверьте трассировку шагов.",
    });
  }

  return { messages: answer, trace, provider: provider.name, steps };
}
