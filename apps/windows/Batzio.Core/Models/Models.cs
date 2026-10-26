using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Batzio.Core.Models;

// Response bodies of the app endpoints (/api/v1/app/*, /auth/*). Amounts are in major units (CHF).

public sealed record UserInfo(string Id, string Name, string Email, string? Locale);
public sealed record TenantInfo(string Id, string Slug, string Name, string Locale);
public sealed record Company(string Slug, string Name, string Role, string Locale);
public sealed record AuthResult(string Token, string Expires, UserInfo User, List<Company> Companies);
public sealed record AccountInfo(UserInfo User, List<Company> Companies);

/// <summary>A destination inside the app, as the server describes it.</summary>
public sealed record AppTarget(string Kind, string? Resource = null, int? Id = null, bool? Create = null, string? Report = null, string? Section = null, string? Href = null);

public sealed record NavTab(string Title, AppTarget Target);
public sealed record NavItem(string Title, string Icon, AppTarget Target, List<NavTab>? Tabs)
{
    public string Key => $"{Title}|{Target.Kind}|{Target.Resource}|{Target.Report}|{Target.Section}";
}
public sealed record NavSection(string Id, string Label, string Icon, List<NavItem> Items);

public sealed record FieldOption(string Value, string Label, string? Tone);

public sealed record FieldDef(
    string Name,
    string Label,
    string Type,
    string? Description = null,
    bool? Required = null,
    bool? ReadOnly = null,
    bool? CreateOnly = null,
    JsonNode? Default = null,
    List<FieldOption>? Options = null,
    string? Ref = null,
    Dictionary<string, JsonNode?>? RefFilter = null,
    bool? List = null,
    bool? Sortable = null,
    string? Placeholder = null,
    string? Section = null,
    bool? Hidden = null,
    string? Format = null,
    string? Term = null)
{
    public bool IsEditable => ReadOnly != true && Hidden != true && Type != "json";
    public FieldOption? Option(JsonNode? value) => value.Str() is { } v ? Options?.FirstOrDefault(o => o.Value == v) : null;
}

public sealed record ChildDef(string Name, string Label, List<FieldDef> Fields);
public sealed record ActionDef(string Name, string Label, string Description, string? Icon, string? Variant, string? Confirm, List<FieldDef>? Input);
public sealed record EmptyCopy(string Title, string Text, string? Mood);
public sealed record NavPlacement(string Group, int Order);

public sealed record ResourceSchema(
    string Name,
    string Singular,
    string Label,
    string LabelPlural,
    string Description,
    string Icon,
    string Area,
    List<FieldDef> Fields,
    List<ChildDef>? Children,
    List<ActionDef>? Actions,
    string? StatusField,
    string View,
    bool SoftDelete,
    bool ReadOnly,
    EmptyCopy? Empty,
    NavPlacement? Nav,
    bool CanWrite,
    bool CanCreate,
    bool Pdf)
{
    public bool IsDocument => View == "document";
    public IEnumerable<FieldDef> ListFields => Fields.Where(f => f.List == true && f.Hidden != true);
    public FieldDef? StatusDef => StatusField is null ? null : Fields.FirstOrDefault(f => f.Name == StatusField);
    public ActionDef? Action(string name) => Actions?.FirstOrDefault(a => a.Name == name);
}

public sealed record ReportInfo(string Id, string Title, string Text, string Icon, string Area, string Params, string? Pdf);
public sealed record GlossaryEntry(string Term, string Text);

public sealed record Bootstrap(
    string Locale,
    string Mode,
    UserInfo? User,
    TenantInfo Tenant,
    string Role,
    Dictionary<string, string> Permissions,
    List<NavSection> Navigation,
    List<ResourceSchema> Resources,
    List<ReportInfo> Reports,
    Dictionary<string, GlossaryEntry?>? Glossary,
    bool Agent,
    string? Inbox,
    List<string>? Examples)
{
    public ResourceSchema? Resource(string name) => Resources.FirstOrDefault(r => r.Name == name);
    public bool Can(string area) => Permissions.TryGetValue(area, out var level) && level != "none";
    public GlossaryEntry? Explain(string? term) => term is not null && Glossary is not null && Glossary.TryGetValue(term, out var e) ? e : null;
}

public sealed record RecordRef(string Resource, int Id, string? Label);

public sealed record WeatherWeek(string Week, double Balance);
public sealed record WeatherLow(double Balance, string Week);
public sealed record MoneyWeather(string Mood, double Cash, double Incoming, double Outgoing, WeatherLow Low, List<WeatherWeek> Weeks);
public sealed record NudgeAction(string Kind, string Label, AppTarget? Target, string? Resource, int? Id, string? Action, string? Prompt, int? FileId, int? InboxId, bool? Primary, bool? Agent);
public sealed record Nudge(string Key, string Icon, string Tone, string Title, string? Text, double? Amount, List<NudgeAction> Actions);
public sealed record ThreadSummary(string Id, string Last, int Count, string Title);
public sealed record TodayScreen(string Greeting, string Name, MoneyWeather? Weather, List<Nudge> Nudges, List<ThreadSummary> Threads);

public sealed record QuickAction(string Id, string Label, bool? Primary);
public sealed record QuickPlan(string Headline, List<string> Details, List<string> Warnings, List<QuickAction> Actions, double? Total);
public sealed record QuickOutcome(string Message, RecordRef? Record);

public sealed record FileRef(int Id, string Name, string? Mime);
public sealed record ToolOutcome(string Id, string Tool, string Title, bool Ok, string? Summary, RecordRef? Record, bool? Pending);
public sealed record ChatTurn(int Id, string Role, string Text, List<FileRef>? Files, List<ToolOutcome>? Tools, bool? Refused);
public sealed record DropOutcome(FileRef File, bool Handled, string Kind, string? Text);
public sealed record StoredFile(FileRef File);

public sealed record RecordList(List<JsonObject> Rows, Dictionary<string, Dictionary<string, string>>? Labels, Dictionary<string, string>? Titles, int Total, int Limit, int Offset, Dictionary<string, double>? Totals);
public sealed record TaxOption(int Id, string Code, double Rate, string Type);
public sealed record RelatedRow(int Id, string Title, JsonNode? Status);
public sealed record RelatedList(string Resource, string Label, string ForeignKey, int Total, List<RelatedRow> Rows);
public sealed record Attachment(int Id, string Name, [property: JsonPropertyName("mime_type")] string? MimeType, long Size);
public sealed record HistoryEntry(int Id, string At, [property: JsonPropertyName("actor_name")] string? ActorName, string Source, string Action, string? Summary);
public sealed record RecordScreen(
    JsonObject Record,
    string Title,
    Dictionary<string, Dictionary<string, string>>? Labels,
    List<TaxOption>? Taxes,
    List<string> Actions,
    bool CanEdit,
    bool CanDelete,
    string? Locked,
    bool Archived,
    string? Pdf,
    List<RelatedList> Related,
    List<Attachment> Files,
    List<HistoryEntry> History);
public sealed record NewRecord(JsonObject Values, List<TaxOption>? Taxes);
public sealed record ActionResponse(string? Message, RecordRef? Redirect);
public sealed record RefOption(int Id, string Label);
public sealed record ItemDefaults(string? Code, string Text, [property: JsonPropertyName("unit_name")] string? UnitName, [property: JsonPropertyName("unit_price")] double UnitPrice, [property: JsonPropertyName("tax_id")] int? TaxId);
public sealed record TotalsLine(double Total, double? Subtotal);
public sealed record TotalsVat(double Rate, double Base, double Vat);
public sealed record DocumentTotals(List<TotalsLine> Lines, [property: JsonPropertyName("total_net")] double TotalNet, [property: JsonPropertyName("total_vat")] double TotalVat, double Rounding, double Total, List<TotalsVat> Vat);
public sealed record SearchHit(string Resource, string ResourceLabel, int Id, string Label);

public sealed record ReportColumn(string Label, string Type, string? Term)
{
    public bool IsNumeric => Type is "money" or "number";
}
public sealed record ReportRow(List<JsonNode?> Cells, string? Style, int? Indent, RecordRef? Link);
public sealed record ReportTable(string? Title, List<ReportColumn> Columns, List<ReportRow> Rows);
public sealed record ReportSummary(string Label, double Value, string? Tone);
public sealed record ReportScreen(string Id, string Title, string Subtitle, string Params, List<ReportSummary> Summary, List<ReportTable> Tables, bool? Balanced, string? Pdf);

public sealed record SettingsForm(List<FieldDef> Fields, JsonObject Values);
public sealed record SettingsForms(SettingsForm Company, SettingsForm Accounting, SettingsForm Texts);
public sealed record NumberFormat(string Key, string Label, string Format, [property: JsonPropertyName("next_value")] int NextValue, string Preview);
public sealed record SettingsScreen(SettingsForms Forms, List<NumberFormat> Numbering, string? Inbox, bool Agent, bool CanWrite);
public sealed record Member([property: JsonPropertyName("user_id")] string UserId, string Email, string Name, string Role);
public sealed record Invitation(string Id, string Email, string Role);
public sealed record TeamScreen(List<Member> Members, List<Invitation> Invitations, string? Me, bool CanWrite);
public sealed record ApiKeyInfo(string Id, string Name, string Prefix, string Scope, string Role, [property: JsonPropertyName("user_name")] string UserName, [property: JsonPropertyName("revoked_at")] string? RevokedAt);
public sealed record CreatedApiKey(string Key, string Id, string Message);
public sealed record InviteResult(bool Added, string? Link, string Message);
public sealed record MessageResult(string Message);
public sealed record BankImportResult(int Imported, int Duplicates, int Suggested, int Booked);
public sealed record PayrollResult(int Created, int Skipped);
