/**
 * Anthropic Messages API client — thin REST wrapper, no SDK.
 *
 * Kept deliberately tiny and dependency-free (same rationale as
 * src/lib/telegram.ts): a serverless webhook shouldn't pull an SDK, and a
 * fetch wrapper survives container recycles without a reinstall.
 *
 * Env:
 *   ANTHROPIC_API_KEY   — required to call the API.
 *   ANTHROPIC_MODEL     — optional override; defaults to a fast, capable model.
 *
 * We only use one shape: "extract structured fields from free text" via a
 * single forced tool call. tool_choice pins the tool so the model always
 * returns a well-formed `input` object matching the given JSON schema.
 */

const API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
};

export type ExtractResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ToolDef = {
  name: string;
  description: string;
  schema: JsonSchema;
};

/**
 * Offer the model several tools and let it pick exactly one (tool_choice
 * "any"). Returns which tool it called + that call's input. Used to route a
 * free-text message to the right handler (create a callout vs list a day).
 */
export async function extractWithTools(opts: {
  system: string;
  userText: string;
  tools: ToolDef[];
  maxTokens?: number;
}): Promise<{ ok: true; name: string; data: any } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "Anthropic not configured" };
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: [{ role: "user", content: opts.userText }],
        tools: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.schema,
        })),
        tool_choice: { type: "any" },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Anthropic ${res.status}: ${body.slice(0, 200)}` };
    }
    const json: any = await res.json();
    const toolUse = Array.isArray(json?.content)
      ? json.content.find((c: any) => c?.type === "tool_use")
      : null;
    if (!toolUse || typeof toolUse.input !== "object") {
      return { ok: false, error: "Model did not return a tool call." };
    }
    return { ok: true, name: toolUse.name, data: toolUse.input };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network error" };
  }
}

/**
 * Ask the model to fill in a single tool call and return its `input`.
 * `toolName`/`toolDescription`/`schema` define the structured output;
 * `system` frames the task and `userText` is the raw message to parse.
 */
export async function extractWithTool<T>(opts: {
  system: string;
  userText: string;
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  maxTokens?: number;
}): Promise<ExtractResult<T>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "Anthropic not configured" };
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: [{ role: "user", content: opts.userText }],
        tools: [
          {
            name: opts.toolName,
            description: opts.toolDescription,
            input_schema: opts.schema,
          },
        ],
        tool_choice: { type: "tool", name: opts.toolName },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Anthropic ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const json: any = await res.json();
    const toolUse = Array.isArray(json?.content)
      ? json.content.find((c: any) => c?.type === "tool_use")
      : null;
    if (!toolUse || typeof toolUse.input !== "object") {
      return { ok: false, error: "Model did not return structured output." };
    }
    return { ok: true, data: toolUse.input as T };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network error" };
  }
}
