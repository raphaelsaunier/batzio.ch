import { Bot, Check, Loader2, MessageSquareText, Paperclip, Plug, Sparkles, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";

// ------------------------------------------------------------------ agents

interface Chat {
  client: string;
  icon: typeof Bot;
  ask: string;
  attachment?: string;
  tools: string[];
  answer: string;
}

export async function AgentChats() {
  const t = await getT();
  const chats: Chat[] = [
    {
      client: t("Claude Desktop, via MCP"),
      icon: Plug,
      ask: t("Invoice Bergsicht Hotels for 4 hours of consulting at 180 and issue it."),
      tools: [t("Found Bergsicht Hotels AG"), t("Created the invoice"), t("Issued it")],
      answer: t("Done: INV-2026-0008 for CHF 778.30 including 8.1 % VAT, due on 25.11.2026. The PDF with the QR-bill is ready."),
    },
    {
      client: t("Batzi, built into every screen"),
      icon: Sparkles,
      ask: t("Who still owes me money?"),
      tools: [t("Checked the open invoices")],
      answer: t("CHF 3’770.50 across four invoices: Rhein Logistik AG 1’827.95 (one 9 days late), Atelier Morel Sàrl 1’456.10 (13 days late), Kaffeerösterei Lindenhof 486.45. Shall I prepare reminders for the two late ones?"),
    },
    {
      client: t("Your own assistant"),
      icon: Bot,
      ask: t("Train to Lausanne for the Morel workshop."),
      attachment: "sbb-ticket.jpg",
      tools: [t("Read the ticket"), t("Booked the expense")],
      answer: t("Booked CHF 87.60 to travel expenses (6640), including CHF 6.56 input VAT, with the ticket attached and linked to the project."),
    },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {chats.map((c) => (
        <figure key={c.client} className="neu-card flex flex-col gap-3 p-5">
          <figcaption className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
            <c.icon className="size-3.5" /> {c.client}
          </figcaption>
          <div className="bg-primary text-primary-foreground ml-6 rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm">
            {c.attachment && (
              <span className="mb-1.5 flex items-center gap-1.5 text-xs opacity-85">
                <Paperclip className="size-3" /> {c.attachment}
              </span>
            )}
            {c.ask}
          </div>
          <ul className="space-y-1">
            {c.tools.map((tool) => (
              <li key={tool} className="text-muted-foreground flex items-center gap-2 text-xs">
                <Check className="text-success size-3.5" /> {tool}
              </li>
            ))}
          </ul>
          <div className="bg-muted mr-6 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-6">{c.answer}</div>
        </figure>
      ))}
    </div>
  );
}

export async function McpConfig() {
  const t = await getT();
  const config = `{
  "mcpServers": {
    "batzio": {
      "type": "http",
      "url": "https://www.batzio.ch/api/mcp",
      "headers": { "Authorization": "Bearer bz_…" }
    }
  }
}`;
  return (
    <div className="neu-card overflow-hidden">
      <div className="text-muted-foreground flex items-center gap-2 border-b px-4 py-2.5 text-xs">
        <MessageSquareText className="size-3.5" /> {t("Connect any MCP client in one paste")}
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-5">
        <code>{config}</code>
      </pre>
    </div>
  );
}

// ------------------------------------------------------------------ API compatibility

export async function CompatDiff() {
  const t = await getT();
  const lines: [string, string][] = [
    [" ", t("# Your integration, unchanged — except two lines:")],
    ["-", "BASE_URL=https://api.your-current-software.ch"],
    ["+", "BASE_URL=https://www.batzio.ch/api/compat"],
    ["-", "TOKEN=<access token from your current software>"],
    ["+", "TOKEN=bz_…   # Settings → API & MCP"],
    [" ", ""],
    [" ", "GET  /2.0/contact?order_by=name_1"],
    [" ", "POST /2.0/kb_invoice/search"],
    [" ", "POST /2.0/kb_invoice/42/issue"],
    [" ", "GET  /3.0/accounting/journal?from=2026-01-01"],
    [" ", "POST /4.0/purchase/bills"],
  ];
  return (
    <div className="overflow-hidden rounded-2xl border bg-zinc-950 text-zinc-100 shadow-[0_30px_60px_-30px_rgb(15_30_60/0.6)]">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400/80" />
        <span className="size-2.5 rounded-full bg-amber-300/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-2 font-mono text-[11px] text-zinc-400">integration.env</span>
      </div>
      <pre className="overflow-x-auto py-3 font-mono text-[12.5px] leading-6">
        {lines.map(([sign, text], i) => (
          <div
            key={i}
            className={cn("px-4 whitespace-pre", sign === "-" && "bg-red-500/12 text-red-200", sign === "+" && "bg-emerald-500/12 text-emerald-200", sign === " " && text.startsWith("#") && "text-zinc-500")}
          >
            <span className="mr-3 inline-block w-2 text-zinc-500 select-none">{sign === " " ? "" : sign}</span>
            {text}
          </div>
        ))}
      </pre>
    </div>
  );
}

export async function CompatCoverage() {
  const t = await getT();
  const areas = [
    t("Contacts & relations"),
    t("Products & stock"),
    t("Quotes, orders, invoices"),
    t("Positions & comments"),
    t("Payments & reminders"),
    t("Projects & time"),
    t("Journal & VAT"),
    t("Bank accounts & payments"),
    t("Supplier bills"),
    t("Expenses"),
    t("Payroll"),
    t("Files"),
  ];
  return (
    <ul className="flex flex-wrap gap-2">
      {areas.map((a) => (
        <li key={a} className="bg-card text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
          <Check className="text-success size-3" /> {a}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ moving in

export async function MoveInSteps() {
  const t = await getT();
  const steps = [
    { title: t("Create an access key"), text: t("In your current accounting software, create an access key for Batzio. It takes two minutes.") },
    { title: t("Paste it into Batzio"), text: t("Under Settings → Move in. Batzio uses it once and never keeps it.") },
    { title: t("Click once"), text: t("Contacts, products, projects, documents with payments, bills, expenses and bookings arrive with their numbers and states.") },
  ];
  const progress: [string, string, boolean][] = [
    [t("Contacts"), "248", true],
    [t("Products & services"), "61", true],
    [t("Projects"), "12", true],
    [t("Invoices"), "1’204", true],
    [t("Supplier bills"), "386", false],
  ];
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <ol className="space-y-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="bg-metal font-display flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">{i + 1}</span>
            <div>
              <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="neu-card p-5" aria-hidden>
        <div className="mb-4 flex items-center gap-3">
          <span className="bg-metal flex size-9 items-center justify-center rounded-xl text-white">
            <Truck className="size-4" />
          </span>
          <div>
            <div className="font-display font-semibold">{t("Moving in…")}</div>
            <div className="text-muted-foreground text-xs">{t("Numbers and states stay as they were")}</div>
          </div>
        </div>
        <ul className="space-y-2">
          {progress.map(([label, n, done]) => (
            <li key={label} className="flex items-center gap-2.5 text-sm">
              <span className={cn("flex size-5 items-center justify-center rounded-full border", done && "bg-success border-success text-white")}>
                {done ? <Check className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
              </span>
              <span className="flex-1">{label}</span>
              <span className="num text-muted-foreground text-xs">{n}</span>
            </li>
          ))}
        </ul>
        <div className="bg-muted mt-4 h-2 overflow-hidden rounded-full">
          <div className="bg-metal h-full w-[82%] rounded-full" />
        </div>
      </div>
    </div>
  );
}
