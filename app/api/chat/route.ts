import { openai } from "@ai-sdk/openai";
import { Arcade } from "@arcadeai/arcadejs";
import {
  executeOrAuthorizeZodTool,
  toZodToolSet,
} from "@arcadeai/arcadejs/lib/index";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";
import { cookies } from "next/headers";

const AUTO_RUN_ALLOWLIST = new Set([
  "Gmail_GetThread",
  "Gmail_ListEmails",
  "Gmail_ListDraftEmails",
  "Gmail_SearchThreads",
  "Gmail_WhoAmI",
  "GoogleCalendar_ListEvents",
  "GoogleCalendar_WhoAmI",
  "GoogleDocs_WhoAmI",
  "GoogleSheets_GenerateGoogleFilePickerUrl",
  "GoogleSheets_GetSpreadsheet",
  "GoogleSheets_GetSpreadsheetMetadata",
  "GoogleSheets_UpdateCells",
  "GoogleSheets_SearchSpreadsheets",
  "GoogleSheets_WhoAmI",
  "Slack_GetConversationMetadata",
  "Slack_WhoAmI",
]);

const CRO_MAX_DEALS = 3;
const MAX_TOOL_OUTPUT_CHARS = 2400;
const MAX_TOOL_COLLECTION_ITEMS = 25;
const SLACK_ALLOWED_TOOLS = new Set([
  "Slack_SendMessage",
  "Slack_SendMessageToChannel",
  "Slack_SendDmToUser",
  "Slack_GetConversationMetadata",
  "Slack_WhoAmI",
]);

const config = {
  mcpServers: ["Slack"],
  individualTools: [
    "Gmail_ListEmails",
    "Gmail_ListDraftEmails",
    "Gmail_SearchThreads",
    "Gmail_GetThread",
    "Gmail_WriteDraftEmail",
    "Gmail_WhoAmI",
    "GoogleSheets_GenerateGoogleFilePickerUrl",
    "GoogleSheets_SearchSpreadsheets",
    "GoogleSheets_GetSpreadsheet",
    "GoogleSheets_GetSpreadsheetMetadata",
    "GoogleSheets_UpdateCells",
    "GoogleSheets_WhoAmI",
    "GoogleCalendar_ListEvents",
    "GoogleCalendar_WhoAmI",
    "GoogleDocs_CreateDocumentFromText",
    "GoogleDocs_InsertTextAtEndOfDocument",
    "GoogleDocs_WhoAmI",
  ],
  toolLimit: 50,
  systemPromptBase: `You are CRO Autopilot, an assistant for revenue teams.
Use tools to collect evidence first, then propose or execute actions.
Never tell users to authorize manually; call the tool and let the app drive OAuth.

Guidelines:
- Use Gmail, Calendar, Sheets, Slack, and Docs tools when available.
- Prioritize drafts for email. Do not send an email unless the user explicitly asks to send it.
- Process at most ${CRO_MAX_DEALS} high-priority deals in each run.
- Batch spreadsheet writes into a single GoogleSheets_UpdateCells call whenever possible.
- Keep outputs concise and include a short "receipts" section listing what changed.
- If a tool call requires approval, explain what action will happen and why.
- If an argument is optional, omit it completely. Never pass null for optional fields.`,
};

type ArcadeTool = {
  description: string;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  parameters: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripNullValues(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : null;
}

function columnLettersToNumber(letters: string): number {
  let result = 0;
  for (const char of letters.toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) {
      return 0;
    }
    result = result * 26 + (code - 64);
  }
  return result;
}

function numberToColumnLetters(columnNumber: number): string {
  if (!Number.isInteger(columnNumber) || columnNumber <= 0) {
    return "A";
  }

  let n = columnNumber;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function parseA1StartCell(cellOrRange: string): { row: number; column: number } | null {
  const raw = cellOrRange.trim();
  if (!raw) {
    return null;
  }

  const noSheetPrefix = raw.includes("!") ? raw.slice(raw.lastIndexOf("!") + 1) : raw;
  const firstCell = noSheetPrefix.split(":")[0]?.trim().replace(/\$/g, "");
  if (!firstCell) {
    return null;
  }

  const match = /^([A-Za-z]+)(\d+)$/.exec(firstCell);
  if (!match) {
    return null;
  }

  const column = columnLettersToNumber(match[1]);
  const row = Number.parseInt(match[2], 10);

  if (!column || !Number.isInteger(row) || row <= 0) {
    return null;
  }

  return { row, column };
}

function normalizeCellValue(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}

function buildRowMapFromRangeValues(
  cellOrRange: string,
  values: unknown
): Record<string, Record<string, string | number | boolean>> | null {
  if (!Array.isArray(values)) {
    return null;
  }

  const start = parseA1StartCell(cellOrRange);
  if (!start) {
    return null;
  }

  const rowMap: Record<string, Record<string, string | number | boolean>> = {};

  for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
    const rowValues = values[rowOffset];
    if (!Array.isArray(rowValues)) {
      continue;
    }

    const rowKey = String(start.row + rowOffset);
    const rowData: Record<string, string | number | boolean> = {};

    for (let columnOffset = 0; columnOffset < rowValues.length; columnOffset += 1) {
      const value = rowValues[columnOffset];
      if (value === undefined) {
        continue;
      }

      const columnKey = numberToColumnLetters(start.column + columnOffset);
      rowData[columnKey] = normalizeCellValue(value);
    }

    if (Object.keys(rowData).length > 0) {
      rowMap[rowKey] = rowData;
    }
  }

  return Object.keys(rowMap).length > 0 ? rowMap : null;
}

function normalizeRowMap(
  value: unknown
): Record<string, Record<string, string | number | boolean>> | null {
  if (!isRecord(value)) {
    return null;
  }

  const rowMap: Record<string, Record<string, string | number | boolean>> = {};

  for (const [rawRowKey, rawRowValue] of Object.entries(value)) {
    const rowNumber = Number.parseInt(rawRowKey, 10);
    if (!Number.isInteger(rowNumber) || rowNumber <= 0 || !isRecord(rawRowValue)) {
      continue;
    }

    const rowData: Record<string, string | number | boolean> = {};

    for (const [rawColumnKey, cellValue] of Object.entries(rawRowValue)) {
      const trimmedKey = rawColumnKey.trim();
      if (!trimmedKey) {
        continue;
      }

      let columnKey: string;
      if (/^\d+$/.test(trimmedKey)) {
        columnKey = numberToColumnLetters(Number.parseInt(trimmedKey, 10));
      } else {
        columnKey = trimmedKey.toUpperCase();
      }

      if (!/^[A-Z]+$/.test(columnKey)) {
        continue;
      }

      rowData[columnKey] = normalizeCellValue(cellValue);
    }

    if (Object.keys(rowData).length > 0) {
      rowMap[String(rowNumber)] = rowData;
    }
  }

  return Object.keys(rowMap).length > 0 ? rowMap : null;
}

function sanitizeUpdateCellsInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...input };
  const explicitRange =
    typeof cleaned.range === "string"
      ? cleaned.range
      : typeof cleaned.start_cell === "string"
        ? cleaned.start_cell
        : null;

  let normalizedRowMap: Record<string, Record<string, string | number | boolean>> | null =
    null;

  if (typeof cleaned.data === "string") {
    const trimmedData = cleaned.data.trim();
    if (trimmedData.length > 0) {
      try {
        const parsed = JSON.parse(trimmedData) as unknown;
        normalizedRowMap = normalizeRowMap(parsed);

        if (!normalizedRowMap && isRecord(parsed)) {
          const parsedRange =
            typeof parsed.range === "string"
              ? parsed.range
              : typeof parsed.start_cell === "string"
                ? parsed.start_cell
                : null;
          if (parsedRange && "values" in parsed) {
            normalizedRowMap = buildRowMapFromRangeValues(parsedRange, parsed.values);
          }
        }
      } catch {
        // Keep original data if it is not valid JSON.
      }
    }
  } else if (isRecord(cleaned.data)) {
    normalizedRowMap = normalizeRowMap(cleaned.data);

    if (!normalizedRowMap) {
      const dataRange =
        typeof cleaned.data.range === "string"
          ? cleaned.data.range
          : typeof cleaned.data.start_cell === "string"
            ? cleaned.data.start_cell
            : null;
      if (dataRange && "values" in cleaned.data) {
        normalizedRowMap = buildRowMapFromRangeValues(dataRange, cleaned.data.values);
      }
    }
  } else if (explicitRange && Array.isArray(cleaned.values)) {
    normalizedRowMap = buildRowMapFromRangeValues(explicitRange, cleaned.values);
  }

  if (normalizedRowMap) {
    cleaned.data = JSON.stringify(normalizedRowMap);
  }

  if (
    typeof cleaned.sheet_position === "string" &&
    /^\d+$/.test(cleaned.sheet_position.trim())
  ) {
    cleaned.sheet_position = Number.parseInt(cleaned.sheet_position, 10);
  }

  delete cleaned.range;
  delete cleaned.start_cell;
  delete cleaned.values;

  return cleaned;
}

function sanitizeSearchSpreadsheetsInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...input };

  const contains = sanitizeStringArray(cleaned.spreadsheet_contains);
  if (contains) {
    cleaned.spreadsheet_contains = contains;
  } else {
    delete cleaned.spreadsheet_contains;
  }

  const notContains = sanitizeStringArray(cleaned.spreadsheet_not_contains);
  if (notContains) {
    cleaned.spreadsheet_not_contains = notContains;
  } else {
    delete cleaned.spreadsheet_not_contains;
  }

  const orderBy = sanitizeStringArray(cleaned.order_by);
  if (orderBy) {
    cleaned.order_by = orderBy;
  } else {
    delete cleaned.order_by;
  }

  if (
    typeof cleaned.search_only_in_shared_drive_id === "string" &&
    cleaned.search_only_in_shared_drive_id.trim().length === 0
  ) {
    delete cleaned.search_only_in_shared_drive_id;
  }

  if (
    typeof cleaned.pagination_token === "string" &&
    cleaned.pagination_token.trim().length === 0
  ) {
    delete cleaned.pagination_token;
  }

  // This flag is causing invalid Drive queries for this demo account.
  delete cleaned.include_organization_domain_spreadsheets;

  return cleaned;
}

function sanitizeToolInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = stripNullValues(input);

  if (toolName === "GoogleSheets_SearchSpreadsheets") {
    return sanitizeSearchSpreadsheetsInput(cleaned);
  }

  if (toolName === "GoogleSheets_UpdateCells") {
    return sanitizeUpdateCellsInput(cleaned);
  }

  return cleaned;
}

function truncateToolOutput(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_TOOL_OUTPUT_CHARS) {
      return value;
    }

    return `${value.slice(0, MAX_TOOL_OUTPUT_CHARS)}... [truncated ${value.length - MAX_TOOL_OUTPUT_CHARS} chars]`;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_TOOL_COLLECTION_ITEMS)
      .map((item) => truncateToolOutput(item, depth + 1));

    if (value.length > MAX_TOOL_COLLECTION_ITEMS) {
      items.push(`[truncated ${value.length - MAX_TOOL_COLLECTION_ITEMS} items]`);
    }

    return items;
  }

  if (depth >= 6) {
    return "[truncated nested object]";
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.entries(objectValue);
    const limitedEntries = entries.slice(0, MAX_TOOL_COLLECTION_ITEMS);
    const truncatedObject: Record<string, unknown> = {};

    for (const [key, nestedValue] of limitedEntries) {
      truncatedObject[key] = truncateToolOutput(nestedValue, depth + 1);
    }

    if (entries.length > MAX_TOOL_COLLECTION_ITEMS) {
      truncatedObject.__truncated_keys = entries.length - MAX_TOOL_COLLECTION_ITEMS;
    }

    return truncatedObject;
  }

  return value;
}

function toVercelTools(arcadeTools: Record<string, unknown>): ToolSet {
  const vercelTools: Record<string, unknown> = {};

  for (const [name, tool] of Object.entries(arcadeTools)) {
    const t = tool as ArcadeTool;
    vercelTools[name] = {
      description: t.description,
      inputSchema: t.parameters,
      needsApproval: !AUTO_RUN_ALLOWLIST.has(name),
      execute: async (input: Record<string, unknown>) => {
        const cleanedInput = sanitizeToolInput(name, input);
        const output = await t.execute(cleanedInput);
        return truncateToolOutput(output);
      },
    };
  }

  return vercelTools as ToolSet;
}

function filterToolkitToolsPreservingShape<T extends { qualified_name: string }>(
  serverName: string,
  tools: T[]
): T[] {
  if (serverName !== "Slack") {
    return tools;
  }

  const filtered = tools.filter((tool) =>
    SLACK_ALLOWED_TOOLS.has(tool.qualified_name)
  );

  if (filtered.length === 0) {
    console.warn(
      "No Slack tools matched the built-in Slack allowlist; using the full Slack toolkit."
    );
    return tools;
  }

  return filtered;
}

function buildSystemPrompt(toolNames: string[]) {
  const docsToolsAvailable = toolNames.some((name) =>
    name.startsWith("GoogleDocs_")
  );

  const docsInstruction = docsToolsAvailable
    ? "Docs tools are available. Create or update a Google Doc deal plan when the user asks for an artifact."
    : "Docs tools are unavailable. If a deal plan artifact is requested, return a markdown plan in chat and include it in Slack instead.";

  return `${config.systemPromptBase}
- ${docsInstruction}
- Keep Slack writes deterministic: use one destination style (channel or DM-by-email) for the whole run.
- If the user asks to list sheets, call GoogleSheets_SearchSpreadsheets first with a broad query (for example limit 50 and order_by modifiedTime desc) before asking follow-up questions.
- For GoogleSheets_SearchSpreadsheets, do not set include_organization_domain_spreadsheets unless the user explicitly asks for it and confirms they are an org admin.
- For GoogleSheets_UpdateCells, data must be a JSON string row map like {"2":{"A":"value"}} where row keys are integer row numbers and column keys are letters. Do not use range/values as the final write format.
- Never claim a tool failed unless a tool in this run returned an error. If it failed, include the exact tool name and error message.
- If sheet search returns no results, explain that Drive access may be limited and call GoogleSheets_GenerateGoogleFilePickerUrl so the user can grant access.`;
}

async function getArcadeTools(userId: string) {
  const arcade = new Arcade();

  const mcpServerTools = await Promise.all(
    config.mcpServers.map(async (serverName) => {
      try {
        const response = await arcade.tools.list({
          toolkit: serverName,
          limit: config.toolLimit,
        });

        return filterToolkitToolsPreservingShape(serverName, response.items);
      } catch (error) {
        console.warn(
          `Unable to list toolkit "${serverName}". Skipping toolkit.`,
          error
        );
        return [];
      }
    })
  );

  const individualToolDefs = await Promise.all(
    config.individualTools.map(async (toolName) => {
      try {
        return await arcade.tools.get(toolName);
      } catch (error) {
        console.warn(`Unable to load tool "${toolName}". Skipping tool.`, error);
        return null;
      }
    })
  );

  const validIndividualTools = individualToolDefs.filter(
    (tool): tool is NonNullable<(typeof individualToolDefs)[number]> =>
      tool !== null
  );

  const allTools = [...mcpServerTools.flat(), ...validIndividualTools];
  const uniqueTools = Array.from(
    new Map(allTools.map((tool) => [tool.qualified_name, tool])).values()
  );

  if (uniqueTools.length === 0) {
    throw new Error("No Arcade tools are available.");
  }

  const arcadeTools = toZodToolSet({
    client: arcade,
    executeFactory: executeOrAuthorizeZodTool,
    tools: uniqueTools,
    userId,
  });

  return toVercelTools(arcadeTools);
}

async function getMemoryTools() {
  const memoryUrl = process.env.DEAL_MEMORY_MCP_URL?.trim();
  if (!memoryUrl) {
    return {
      memoryTools: null as ToolSet | null,
      closeMemoryClient: null as (() => Promise<void>) | null,
    };
  }

  try {
    const memoryClient = await createMCPClient({
      transport: {
        type: "http",
        url: memoryUrl,
      },
    });

    const memoryTools = (await memoryClient.tools()) as ToolSet;

    return {
      memoryTools,
      closeMemoryClient: async () => {
        await memoryClient.close();
      },
    };
  } catch (error) {
    console.warn(
      `Unable to connect to memory MCP server at "${memoryUrl}". Continuing without memory tools.`,
      error
    );
    return {
      memoryTools: null as ToolSet | null,
      closeMemoryClient: null as (() => Promise<void>) | null,
    };
  }
}

export async function POST(req: Request) {
  let closeMemoryClient: (() => Promise<void>) | null = null;

  try {
    const { messages } = (await req.json()) as {
      messages: Parameters<typeof convertToModelMessages>[0];
    };

    const store = await cookies();
    const userId = store.get("arcade_user_id")?.value;
    if (!userId) {
      return Response.json(
        { error: "Session not initialized. Call /api/session first." },
        { status: 401 }
      );
    }

    const [arcadeTools, memory] = await Promise.all([
      getArcadeTools(userId),
      getMemoryTools(),
    ]);
    closeMemoryClient = memory.closeMemoryClient;

    const tools = memory.memoryTools
      ? ({ ...arcadeTools, ...memory.memoryTools } as ToolSet)
      : arcadeTools;
    const systemPrompt = buildSystemPrompt(Object.keys(tools));
    const modelName = process.env.OPENAI_MODEL || "gpt-5.2";

    const result = streamText({
      model: openai(modelName),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(12),
      onFinish: async () => {
        await closeMemoryClient?.();
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    await closeMemoryClient?.();
    console.error("Chat API error:", error);
    return Response.json(
      { error: "Failed to process chat request" },
      { status: 500 }
    );
  }
}
