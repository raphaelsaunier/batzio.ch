import { restoreRecord } from "@/lib/server/crud";
import { today } from "@/lib/format";
import { defineResource } from "../define";
import { CURRENCY_OPTIONS, f, opt } from "../fields";
import { getResource } from "../registry";
import type { ResourceDef, Row } from "../types";

export const inventoryResources: ResourceDef[] = [
  defineResource({
    name: "items",
    singular: "item",
    label: "Product / service",
    labelPlural: "Products & services",
    description: "Catalogue of products and services with prices, VAT, accounts and stock.",
    table: "items",
    area: "inventory",
    icon: "Package",
    nav: { group: "inventory", order: 10 },
    numbering: { field: "nr", sequence: "item" },
    softDelete: true,
    fields: [
      f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code", section: "General" }),
      f.enum("type", "Type", [opt("product", "Product", "info"), opt("service", "Service", "primary")], {
        default: "service",
        list: true,
        filter: true,
        span: 2,
      }),
      f.ref("unit_id", "Unit", "units", { span: 2 }),
      f.string("name", "Name", { required: true, list: true, search: true, sortable: true, span: 6, format: "strong" }),
      f.text("description", "Description", { search: true, span: 6 }),
      f.decimal("sale_price", "Sale price", { list: true, sortable: true, span: 2, section: "Pricing" }),
      f.decimal("purchase_price", "Purchase price", { list: true, span: 2 }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { default: "CHF", span: 2 }),
      f.ref("sales_tax_id", "Sales VAT", "taxes", { refFilter: { type: "sales" }, span: 3 }),
      f.ref("purchase_tax_id", "Input VAT", "taxes", { refFilter: { type: "purchase" }, span: 3 }),
      f.ref("revenue_account_id", "Revenue account", "accounts", { refFilter: { type: "revenue" }, span: 3 }),
      f.ref("expense_account_id", "Expense account", "accounts", { refFilter: { type: "expense" }, span: 3 }),
      f.boolean("is_stock_tracked", "Track stock", { filter: true, span: 2, section: "Stock" }),
      f.decimal("stock_quantity", "In stock", { list: true, readOnly: true, span: 2 }),
      f.decimal("stock_minimum", "Minimum stock", { span: 2 }),
      f.ref("stock_location_id", "Location", "stock_locations", { span: 3 }),
      f.ref("stock_area_id", "Area", "stock_areas", { span: 3 }),
      f.ref("supplier_id", "Preferred supplier", "contacts", { refFilter: { is_supplier: true }, span: 3, section: "Purchasing" }),
      f.string("ean", "EAN / GTIN", { search: true, span: 2 }),
      f.decimal("weight_kg", "Weight (kg)", { span: 1 }),
      f.datetime("archived_at", "Archived", { readOnly: true, hidden: true }),
    ],
    titleSql: "coalesce(nr || ' – ', '') || name",
    defaultSort: { field: "name", dir: "asc" },
    related: [{ resource: "stock_movements", foreignKey: "item_id", label: "Stock movements" }],
    actions: [
      {
        name: "adjust_stock",
        label: "Adjust stock",
        description: "Books a manual stock correction (positive or negative quantity).",
        icon: "PackagePlus",
        available: (r: Row) => !!r.is_stock_tracked,
        input: [
          f.decimal("quantity", "Quantity (+/-)", { required: true }),
          f.string("note", "Reason"),
        ],
        run: async (ctx, r, input) => {
          const qty = Number(input.quantity);
          await ctx.db.batch([
            {
              sql: "INSERT INTO stock_movements (item_id, date, quantity, reason, note, created_by, updated_by) VALUES (?, ?, ?, 'adjustment', ?, ?, ?)",
              params: [r.id, today(), qty, input.note ?? null, ctx.actor.name, ctx.actor.name],
            },
            { sql: "UPDATE items SET stock_quantity = stock_quantity + ? WHERE id = ?", params: [qty, r.id] },
          ]);
          return { message: "Stock adjusted by {qty}.", vars: { qty } };
        },
      },
      {
        name: "restore",
        label: "Restore",
        description: "Restores an archived product or service.",
        icon: "ArchiveRestore",
        available: (r: Row) => !!r.archived_at,
        run: async (ctx, r) => {
          await restoreRecord(ctx, getResource("items")!, Number(r.id));
          return { message: "Restored." };
        },
      },
    ],
  }),
  defineResource({
    name: "stock_movements",
    singular: "stock_movement",
    label: "Stock movement",
    labelPlural: "Stock movements",
    description: "Every change of stock quantity, from deliveries, receipts and corrections.",
    table: "stock_movements",
    area: "inventory",
    icon: "ArrowDownUp",
    nav: { group: "inventory", order: 20 },
    readOnly: true,
    fields: [
      f.date("date", "Date", { list: true, sortable: true, filter: true }),
      f.ref("item_id", "Item", "items", { list: true, filter: true }),
      f.decimal("quantity", "Quantity", { list: true }),
      f.enum(
        "reason",
        "Reason",
        [
          opt("adjustment", "Adjustment"),
          opt("delivery", "Delivery", "info"),
          opt("purchase_receipt", "Goods receipt", "success"),
          opt("delivery_reverted", "Delivery reverted", "muted"),
          opt("delivery_cancelled", "Delivery cancelled", "muted"),
          opt("receipt_reverted", "Receipt reverted", "muted"),
        ],
        { list: true, filter: true },
      ),
      f.int("document_id", "Document", { list: true }),
      f.string("note", "Note", { list: true, search: true }),
    ],
    titleSql: "date || ' ' || quantity",
    defaultSort: { field: "date", dir: "desc" },
  }),
  defineResource({
    name: "stock_locations",
    singular: "stock_location",
    label: "Stock location",
    labelPlural: "Stock locations",
    description: "Warehouses and storage sites.",
    table: "stock_locations",
    area: "inventory",
    icon: "Warehouse",
    nav: { group: "inventory", order: 30 },
    fields: [
      f.string("name", "Name", { required: true, list: true, search: true, span: 3 }),
      f.text("address", "Address", { list: true, span: 3 }),
    ],
    titleSql: "name",
    defaultSort: { field: "name", dir: "asc" },
    related: [{ resource: "stock_areas", foreignKey: "location_id", label: "Areas" }],
  }),
  defineResource({
    name: "stock_areas",
    singular: "stock_area",
    label: "Stock area",
    labelPlural: "Stock areas",
    description: "Shelves, bins or zones within a stock location.",
    table: "stock_areas",
    area: "inventory",
    icon: "LayoutGrid",
    nav: false,
    fields: [
      f.ref("location_id", "Location", "stock_locations", { required: true, list: true, filter: true, span: 3 }),
      f.string("name", "Name", { required: true, list: true, search: true, span: 3 }),
    ],
    titleSql: "name",
    defaultSort: { field: "name", dir: "asc" },
  }),
];
