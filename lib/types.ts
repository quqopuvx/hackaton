export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface TraceEntry {
  step: number;
  kind: "call" | "result" | "text" | "error";
  name?: string;
  detail: string;
  at: string;
}

export interface AgentResult {
  messages: Array<{ role: "assistant"; content: string }>;
  trace: TraceEntry[];
  provider: string;
  steps: number;
}

export interface Item {
  id: string;
  title: string;
  status: "new" | "in_progress" | "done";
  createdAt: string;
}

/** Сообщение в state интерфейса (без системных/tool-сообщений). */
export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}
