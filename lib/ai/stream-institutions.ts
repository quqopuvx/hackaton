import { readLines } from "../read-lines.ts";

export async function readInstitutionCompletion(
  body: ReadableStream<Uint8Array>,
  onRecord: (record: unknown) => void,
): Promise<{ content: string; finishReason?: string }> {
  let content = "";
  let finishReason: string | undefined;
  let offset = -1;
  let objectStart = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let arrayEnded = false;
  let eventData: string[] = [];

  function consumeEvent(): boolean {
    const data = eventData.join("\n");
    eventData = [];
    if (!data) return false;
    if (data === "[DONE]") return true;
    const event = JSON.parse(data) as {
      error?: unknown;
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
    };
    if (event.error) throw new Error("CheapVibeCode сообщил об ошибке во время ответа.");
    const choice = event.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (typeof choice?.delta?.content !== "string") return Boolean(choice?.finish_reason);
    content += choice.delta.content;

    if (arrayEnded) return Boolean(choice?.finish_reason);
    if (offset < 0) {
      const prefix = /^\s*(?:```(?:json)?\s*)?(?:\{\s*"institutions"\s*:\s*)?\[/.exec(content);
      if (!prefix) return Boolean(choice?.finish_reason);
      offset = prefix[0].length;
    }
    for (; offset < content.length; offset++) {
      const char = content[offset];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === "{" || char === "[") {
        if (depth === 0 && char === "{") objectStart = offset;
        depth++;
      } else if (char === "}" || char === "]") {
        if (depth === 0) {
          arrayEnded = true;
          break;
        }
        depth--;
        if (depth === 0 && objectStart >= 0) {
          onRecord(JSON.parse(content.slice(objectStart, offset + 1)));
          objectStart = -1;
        }
      }
    }
    return Boolean(choice?.finish_reason);
  }

  for await (const line of readLines(body)) {
    if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
    if (!line && consumeEvent()) return { content, finishReason };
  }
  consumeEvent();
  return { content, finishReason };
}
