import { isValidUid } from "@batzio/core/swiss/identifiers";
import { AppError } from "../../errors";
import { restoreRecord } from "../../crud";
import { defineResource } from "../define";
import { getResource } from "../registry";
import { CURRENCY_OPTIONS, LANGUAGE_OPTIONS, f, opt } from "../fields";
import type { ResourceDef, Row } from "../types";

const CONTACT_TITLE_SQL =
  "CASE WHEN type = 'person' THEN trim(coalesce(name_2, '') || ' ' || name_1) ELSE name_1 END";

export const contactResources: ResourceDef[] = [
  defineResource({
    name: "contacts",
    singular: "contact",
    label: "Contact",
    labelPlural: "Contacts",
    description: "Customers, suppliers and people. Companies and persons share one address book.",
    table: "contacts",
    area: "contacts",
    icon: "Users",
    nav: { group: "contacts", order: 10 },
    numbering: { field: "nr", sequence: "contact" },
    softDelete: true,
    fields: [
      f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code", section: "General" }),
      f.enum("type", "Type", [opt("company", "Company", "info"), opt("person", "Person", "neutral")], {
        required: true,
        default: "company",
        list: true,
        filter: true,
        span: 2,
      }),
      f.string("name_1", "Company / last name", { required: true, list: true, search: true, sortable: true, span: 3, format: "strong" }),
      f.string("name_2", "Name addition / first name", { search: true, span: 3 }),
      f.ref("salutation_id", "Salutation", "salutations", { span: 2 }),
      f.ref("title_id", "Title", "titles", { span: 2 }),
      f.date("birthday", "Birthday", { span: 2 }),
      f.string("street", "Street", { span: 4, section: "Address" }),
      f.string("house_number", "No.", { span: 2 }),
      f.string("address_addition", "Address addition", { span: 6, placeholder: "c/o, P.O. Box" }),
      f.string("postcode", "Postcode", { list: false, search: true, span: 2 }),
      f.string("city", "City", { list: true, search: true, sortable: true, span: 2 }),
      f.string("country_code", "Country", { default: "CH", list: true, filter: true, maxLength: 2, span: 2, format: "code" }),
      f.email("email", "Email", { list: true, search: true, span: 3, section: "Communication" }),
      f.email("email_2", "Email (secondary)", { span: 3 }),
      f.phone("phone", "Phone", { list: true, search: true, span: 2 }),
      f.phone("phone_mobile", "Mobile", { span: 2 }),
      f.url("website", "Website", { span: 2 }),
      f.enum("language", "Language", LANGUAGE_OPTIONS, { default: "de", span: 2, section: "Commercial" }),
      f.tags("group_ids", "Groups", "contact_groups", { span: 4, filter: true }),
      f.ref("sector_id", "Sector", "contact_sectors", { filter: true, span: 2 }),
      f.string("vat_number", "VAT / UID number", { span: 2, placeholder: "CHE-123.456.789 MWST" }),
      f.iban("iban", "IBAN (for payments)", { span: 2 }),
      f.ref("payment_term_id", "Payment term", "payment_terms", { span: 2 }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { span: 2 }),
      f.percent("discount_percent", "Default discount %", { span: 2, min: 0, max: 100 }),
      f.boolean("is_customer", "Customer", { default: true, filter: true, span: 1 }),
      f.boolean("is_supplier", "Supplier", { default: false, filter: true, span: 1 }),
      f.string("owner_user_id", "Account owner", { hidden: true }),
      f.text("remarks", "Remarks", { span: 6, section: "Notes" }),
      f.datetime("archived_at", "Archived", { readOnly: true, hidden: true }),
    ],
    titleSql: CONTACT_TITLE_SQL,
    subtitleField: "city",
    defaultSort: { field: "name_1", dir: "asc" },
    related: [
      { resource: "invoices", foreignKey: "contact_id", label: "Invoices" },
      { resource: "quotes", foreignKey: "contact_id", label: "Quotes" },
      { resource: "orders", foreignKey: "contact_id", label: "Orders" },
      { resource: "bills", foreignKey: "contact_id", label: "Bills" },
      { resource: "projects", foreignKey: "contact_id", label: "Projects" },
      { resource: "contact_relations", foreignKey: "contact_id", label: "Relations" },
      { resource: "additional_addresses", foreignKey: "contact_id", label: "Addresses" },
      { resource: "notes", foreignKey: "contact_id", label: "Notes" },
    ],
    hooks: {
      prepare: (_ctx, data) => {
        if (typeof data.vat_number === "string" && data.vat_number.trim().toUpperCase().startsWith("CHE") && !isValidUid(data.vat_number)) {
          throw new AppError("validation", "The UID number is not valid.", { vat_number: "Invalid UID check digit" });
        }
        if (typeof data.country_code === "string") data.country_code = data.country_code.toUpperCase();
        return data;
      },
    },
    actions: [
      {
        name: "restore",
        label: "Restore",
        description: "Restores an archived contact.",
        icon: "ArchiveRestore",
        available: (r: Row) => !!r.archived_at,
        run: async (ctx, r) => {
          await restoreRecord(ctx, getResource("contacts")!, Number(r.id));
          return { message: "Contact restored." };
        },
      },
    ],
  }),
  defineResource({
    name: "contact_relations",
    singular: "contact_relation",
    label: "Contact relation",
    labelPlural: "Contact relations",
    description: "Links between contacts, e.g. a person working at a company.",
    table: "contact_relations",
    area: "contacts",
    icon: "Network",
    nav: false,
    fields: [
      f.ref("contact_id", "Contact", "contacts", { required: true, list: true, filter: true, span: 3 }),
      f.ref("related_contact_id", "Related contact", "contacts", { required: true, list: true, filter: true, span: 3 }),
      f.string("description", "Role / description", { list: true, search: true, span: 6, placeholder: "CEO, accountant…" }),
    ],
    titleSql: "coalesce(description, 'Relation')",
    defaultSort: { field: "id", dir: "desc" },
  }),
  defineResource({
    name: "additional_addresses",
    singular: "additional_address",
    label: "Additional address",
    labelPlural: "Additional addresses",
    description: "Delivery, billing or other addresses of a contact.",
    table: "additional_addresses",
    area: "contacts",
    icon: "MapPin",
    nav: false,
    fields: [
      f.ref("contact_id", "Contact", "contacts", { required: true, list: true, filter: true, span: 3 }),
      f.enum("kind", "Kind", [opt("delivery", "Delivery"), opt("billing", "Billing"), opt("other", "Other")], { default: "delivery", list: true, span: 3 }),
      f.string("name", "Name", { required: true, list: true, search: true, span: 6 }),
      f.string("street", "Street", { span: 4 }),
      f.string("house_number", "No.", { span: 2 }),
      f.string("postcode", "Postcode", { list: true, span: 2 }),
      f.string("city", "City", { list: true, search: true, span: 2 }),
      f.string("country_code", "Country", { default: "CH", maxLength: 2, span: 2 }),
      f.text("description", "Notes", { span: 6 }),
    ],
    titleSql: "name",
    defaultSort: { field: "name", dir: "asc" },
  }),
  defineResource({
    name: "notes",
    singular: "note",
    label: "Note",
    labelPlural: "Notes",
    description: "Notes and call logs attached to contacts or projects.",
    table: "notes",
    area: "contacts",
    icon: "StickyNote",
    nav: { group: "contacts", order: 20 },
    fields: [
      f.string("subject", "Subject", { required: true, list: true, search: true, span: 4, format: "strong" }),
      f.date("event_date", "Date", { list: true, sortable: true, default: "$today", span: 2 }),
      f.ref("contact_id", "Contact", "contacts", { list: true, filter: true, span: 3 }),
      f.ref("project_id", "Project", "projects", { list: true, filter: true, span: 3 }),
      f.text("body", "Note", { search: true, span: 6 }),
      f.string("user_id", "Author", { hidden: true }),
    ],
    titleSql: "subject",
    defaultSort: { field: "event_date", dir: "desc" },
  }),
];
