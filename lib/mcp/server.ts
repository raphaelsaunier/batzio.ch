import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { runTool, toolkit } from "@/lib/agent/toolkit";
import type { Ctx } from "@/lib/server/ctx";
import { toAppError } from "@/lib/server/errors";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const INSTRUCTIONS = `Batzio is a Swiss business and accounting platform (contacts, quotes, orders, invoices with QR-bill, supplier bills, expenses, double-entry ledger with Swiss VAT, banking, projects, time tracking, payroll).
Conventions: amounts are decimal numbers in CHF (or the document currency), dates are YYYY-MM-DD.
Start with list_resource_types to discover resources, fields and workflow actions. Use search_records to find records before updating them.
State changes (issue an invoice, record a payment, book a bill…) are done with run_record_action. Issued documents are locked; revert them to draft first.
Shortcuts: create_invoice, create_bill (scanned supplier invoices), create_expense (receipts), log_time, import_rows (lists you extracted), create_journal_entry.
Setup is steerable too: update_company_settings, update_accounting_settings, update_document_texts, set_number_format, set_company_logo, invite_member.
Every change you make is recorded in the audit log with source "MCP".`;

/** Builds an MCP server bound to one authenticated company context. */
export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: "batzio", version: "1.1.0", title: `Batzio – ${ctx.tenant.name}` },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  for (const tool of toolkit()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: { readOnlyHint: !!tool.readOnly, destructiveHint: !!tool.confirm },
      },
      async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          return { content: [{ type: "text", text: JSON.stringify(await runTool(ctx, tool, args), null, 2) }] };
        } catch (error) {
          const e = toAppError(error);
          return { isError: true, content: [{ type: "text", text: `${e.code}: ${e.message}${e.fields ? ` ${JSON.stringify(e.fields)}` : ""}` }] };
        }
      },
    );
  }
  return server;
}
