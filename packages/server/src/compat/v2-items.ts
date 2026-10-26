import { currencyCode, currencyId, userOf } from "./lookup";
import { crud, has, pick, type Mapping } from "./table";
import { bool, decOrNull, type Route } from "./wire";

/** article_type_id: 1 physical product, 2 service. */
export const itemMapping: Mapping = {
  table: "items",
  area: "inventory",
  resource: "items",
  label: "Item",
  filter: () => ({ sql: "archived_at IS NULL" }),
  columns: {
    id: "id",
    intern_code: "nr",
    intern_name: "name",
    intern_description: "description",
    article_type_id: { sql: "CASE type WHEN 'service' THEN 2 ELSE 1 END" },
    contact_id: "supplier_id",
    sale_price: "sale_price",
    purchase_price: "purchase_price",
    tax_id: "sales_tax_id",
    unit_id: "unit_id",
    is_stock: "is_stock_tracked",
    stock_nr: "stock_quantity",
  },
  defaultOrder: "id",
  extras: ["deliverer_code", "deliverer_name", "deliverer_description", "width", "height", "volume", "html_text", "remarks", "delivery_price", "article_group_id"],
  read: async (r, ctx) => {
    const stock = Number(r.stock_quantity ?? 0);
    return {
      id: r.id,
      user_id: userOf(ctx, null),
      article_type_id: r.type === "service" ? 2 : 1,
      contact_id: r.supplier_id ?? null,
      deliverer_code: null,
      deliverer_name: null,
      deliverer_description: null,
      intern_code: r.nr ?? "",
      intern_name: r.name,
      intern_description: r.description ?? null,
      purchase_price: decOrNull(r.purchase_price),
      sale_price: decOrNull(r.sale_price),
      purchase_total: r.purchase_price === null || r.purchase_price === undefined ? null : Number(r.purchase_price),
      sale_total: r.sale_price === null || r.sale_price === undefined ? null : Number(r.sale_price),
      currency_id: await currencyId(ctx, r.currency_code),
      tax_income_id: r.sales_tax_id ?? null,
      tax_id: r.sales_tax_id ?? null,
      tax_expense_id: r.purchase_tax_id ?? null,
      unit_id: r.unit_id ?? null,
      is_stock: bool(r.is_stock_tracked),
      stock_id: r.stock_location_id ?? null,
      stock_place_id: r.stock_area_id ?? null,
      stock_nr: Math.trunc(stock),
      stock_min_nr: Math.trunc(Number(r.stock_minimum ?? 0)),
      stock_reserved_nr: 0,
      stock_available_nr: Math.trunc(stock),
      stock_picked_nr: 0,
      stock_disposed_nr: 0,
      stock_ordered_nr: 0,
      width: null,
      height: null,
      weight: r.weight_kg === null || r.weight_kg === undefined ? null : Math.round(Number(r.weight_kg) * 1000),
      volume: null,
      html_text: null,
      remarks: null,
      delivery_price: null,
      article_group_id: null,
      account_id: r.revenue_account_id ?? null,
      expense_account_id: r.expense_account_id ?? null,
    };
  },
  write: async (b, ctx, existing) => {
    const out = pick(b, {
      article_type_id: (v) => ({ type: Number(v) === 2 ? "service" : "product" }),
      contact_id: "supplier_id",
      intern_code: "nr",
      intern_name: "name",
      intern_description: "description",
      purchase_price: (v) => ({ purchase_price: v === null || v === "" ? null : Number(v) }),
      sale_price: (v) => ({ sale_price: v === null || v === "" ? null : Number(v) }),
      tax_income_id: "sales_tax_id",
      tax_id: (v, body) => (has(body, "tax_income_id") ? {} : { sales_tax_id: v }),
      tax_expense_id: "purchase_tax_id",
      unit_id: "unit_id",
      is_stock: (v) => ({ is_stock_tracked: bool(v) }),
      stock_id: "stock_location_id",
      stock_place_id: "stock_area_id",
      stock_min_nr: (v) => ({ stock_minimum: Number(v) }),
      weight: (v) => ({ weight_kg: v === null || v === "" ? null : Number(v) / 1000 }),
      account_id: "revenue_account_id",
      expense_account_id: "expense_account_id",
    });
    if (has(b, "currency_id")) out.currency_code = (await currencyCode(ctx, b.currency_id)) ?? "CHF";
    // Opening stock can be set on create; later changes go through stock movements.
    if (has(b, "stock_nr")) out.stock_quantity = Number(b.stock_nr) || 0;
    if (!existing) {
      out.name ??= "Item";
      out.sale_price ??= 0;
    }
    return out;
  },
};

export function itemRoutes(): Route[] {
  return crud("/2.0/article", "article_id", itemMapping, ["list", "create", "search", "show", "edit", "delete"]);
}
