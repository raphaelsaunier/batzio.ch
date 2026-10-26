package ch.batzio.app.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Response bodies of the app endpoints. Amounts are in major units (CHF).

@Serializable data class UserInfo(val id: String, val name: String, val email: String, val locale: String? = null)
@Serializable data class TenantInfo(val id: String, val slug: String, val name: String, val locale: String)
@Serializable data class Company(val slug: String, val name: String, val role: String, val locale: String)
@Serializable data class AuthResult(val token: String, val expires: String, val user: UserInfo, val companies: List<Company>)
@Serializable data class AccountInfo(val user: UserInfo, val companies: List<Company>)

/** A destination inside the app, as the server describes it. */
@Serializable
data class AppTarget(
    val kind: String,
    val resource: String? = null,
    val id: Int? = null,
    val create: Boolean? = null,
    val report: String? = null,
    val section: String? = null,
    val href: String? = null,
)

@Serializable data class NavTab(val title: String, val target: AppTarget)
@Serializable data class NavItem(val title: String, val icon: String, val target: AppTarget, val tabs: List<NavTab> = emptyList()) {
    val key: String get() = "$title|${target.kind}|${target.resource}|${target.report}|${target.section}"
}
@Serializable data class NavSection(val id: String, val label: String, val icon: String, val items: List<NavItem>)

@Serializable data class FieldOption(val value: String, val label: String, val tone: String? = null)

@Serializable
data class FieldDef(
    val name: String,
    val label: String,
    val type: String,
    val description: String? = null,
    val required: Boolean? = null,
    val readOnly: Boolean? = null,
    val createOnly: Boolean? = null,
    val default: JsonElement? = null,
    val options: List<FieldOption>? = null,
    val ref: String? = null,
    val refFilter: Map<String, JsonElement>? = null,
    val list: Boolean? = null,
    val sortable: Boolean? = null,
    val placeholder: String? = null,
    val section: String? = null,
    val hidden: Boolean? = null,
    val format: String? = null,
    val term: String? = null,
) {
    val isEditable: Boolean get() = readOnly != true && hidden != true && type != "json"
    fun option(value: JsonElement?): FieldOption? = value.str?.let { v -> options?.firstOrNull { it.value == v } }
}

@Serializable data class ChildDef(val name: String, val label: String, val fields: List<FieldDef>)
@Serializable data class ActionDef(
    val name: String,
    val label: String,
    val description: String,
    val icon: String? = null,
    val variant: String? = null,
    val confirm: String? = null,
    val input: List<FieldDef>? = null,
)
@Serializable data class EmptyCopy(val title: String, val text: String, val mood: String? = null)
@Serializable data class NavPlacement(val group: String, val order: Int)

@Serializable
data class ResourceSchema(
    val name: String,
    val singular: String,
    val label: String,
    val labelPlural: String,
    val description: String,
    val icon: String,
    val area: String,
    val fields: List<FieldDef>,
    val children: List<ChildDef> = emptyList(),
    val actions: List<ActionDef> = emptyList(),
    val statusField: String? = null,
    val view: String = "default",
    val softDelete: Boolean = false,
    val readOnly: Boolean = false,
    val empty: EmptyCopy? = null,
    val nav: NavPlacement? = null,
    val canWrite: Boolean = false,
    val canCreate: Boolean = false,
    val pdf: Boolean = false,
) {
    val isDocument get() = view == "document"
    val listFields get() = fields.filter { it.list == true && it.hidden != true }
    val statusDef get() = statusField?.let { s -> fields.firstOrNull { it.name == s } }
    fun action(name: String) = actions.firstOrNull { it.name == name }
}

@Serializable data class ReportInfo(val id: String, val title: String, val text: String, val icon: String, val area: String, val params: String, val pdf: String? = null)
@Serializable data class GlossaryEntry(val term: String, val text: String)

@Serializable
data class Bootstrap(
    val locale: String,
    val mode: String,
    val user: UserInfo? = null,
    val tenant: TenantInfo,
    val role: String,
    val permissions: Map<String, String>,
    val navigation: List<NavSection>,
    val resources: List<ResourceSchema>,
    val reports: List<ReportInfo>,
    val glossary: Map<String, GlossaryEntry?> = emptyMap(),
    val agent: Boolean = false,
    val inbox: String? = null,
    val examples: List<String> = emptyList(),
) {
    fun resource(name: String) = resources.firstOrNull { it.name == name }
    fun can(area: String) = (permissions[area] ?: "none") != "none"
    fun explain(term: String?) = term?.let { glossary[it] }
}

@Serializable data class RecordRef(val resource: String, val id: Int, val label: String? = null)

@Serializable data class WeatherWeek(val week: String, val balance: Double)
@Serializable data class WeatherLow(val balance: Double, val week: String)
@Serializable data class MoneyWeather(val mood: String, val cash: Double, val incoming: Double, val outgoing: Double, val low: WeatherLow, val weeks: List<WeatherWeek>)
@Serializable data class NudgeAction(
    val kind: String,
    val label: String,
    val target: AppTarget? = null,
    val resource: String? = null,
    val id: Int? = null,
    val action: String? = null,
    val prompt: String? = null,
    val fileId: Int? = null,
    val inboxId: Int? = null,
    val primary: Boolean? = null,
    val agent: Boolean? = null,
)
@Serializable data class Nudge(val key: String, val icon: String, val tone: String, val title: String, val text: String? = null, val amount: Double? = null, val actions: List<NudgeAction> = emptyList())
@Serializable data class InboxItem(val id: Int, val source: String, val status: String, val title: String, val file_id: Int? = null)
@Serializable data class ThreadSummary(val id: String, val last: String, val count: Int, val title: String)
@Serializable data class TodayScreen(val greeting: String, val name: String, val weather: MoneyWeather? = null, val nudges: List<Nudge> = emptyList(), val inbox: List<InboxItem> = emptyList(), val threads: List<ThreadSummary> = emptyList())

@Serializable data class QuickAction(val id: String, val label: String, val primary: Boolean? = null)
@Serializable data class QuickPlan(val headline: String, val details: List<String> = emptyList(), val warnings: List<String> = emptyList(), val actions: List<QuickAction> = emptyList(), val total: Double? = null)
@Serializable data class QuickOutcome(val message: String, val record: RecordRef? = null)

@Serializable data class FileRef(val id: Int, val name: String, val mime: String? = null)
@Serializable data class ToolOutcome(val id: String, val tool: String, val title: String, val ok: Boolean, val summary: String? = null, val record: RecordRef? = null, val pending: Boolean? = null)
@Serializable data class ChatTurn(val id: Int, val role: String, val text: String, val files: List<FileRef>? = null, val tools: List<ToolOutcome>? = null, val refused: Boolean? = null)
@Serializable data class DropOutcome(val file: FileRef, val handled: Boolean, val kind: String, val text: String? = null, val records: List<RecordRef> = emptyList())
@Serializable data class StoredFile(val file: FileRef)

@Serializable data class RecordList(
    val rows: List<JsonObject>,
    val labels: Map<String, Map<String, String>> = emptyMap(),
    val titles: Map<String, String> = emptyMap(),
    val total: Int,
    val limit: Int,
    val offset: Int,
    val totals: Map<String, Double> = emptyMap(),
)
@Serializable data class TaxOption(val id: Int, val code: String, val rate: Double, val type: String)
@Serializable data class RelatedRow(val id: Int, val title: String, val status: JsonElement? = null)
@Serializable data class RelatedList(val resource: String, val label: String, val foreignKey: String, val total: Int, val rows: List<RelatedRow>)
@Serializable data class Attachment(val id: Int, val name: String, val mime_type: String? = null, val size: Long = 0)
@Serializable data class HistoryEntry(val id: Int, val at: String, val actor_name: String? = null, val source: String, val action: String, val summary: String? = null)
@Serializable data class RecordScreen(
    val record: JsonObject,
    val title: String,
    val labels: Map<String, Map<String, String>> = emptyMap(),
    val taxes: List<TaxOption> = emptyList(),
    val actions: List<String> = emptyList(),
    val canEdit: Boolean = false,
    val canDelete: Boolean = false,
    val locked: String? = null,
    val archived: Boolean = false,
    val pdf: String? = null,
    val related: List<RelatedList> = emptyList(),
    val files: List<Attachment> = emptyList(),
    val history: List<HistoryEntry> = emptyList(),
)
@Serializable data class NewRecord(val values: JsonObject, val taxes: List<TaxOption> = emptyList())
@Serializable data class ActionResponse(val message: String? = null, val redirect: RecordRef? = null)
@Serializable data class RefOption(val id: Int, val label: String)
@Serializable data class ItemDefaults(val code: String? = null, val text: String, val unit_name: String? = null, val unit_price: Double, val tax_id: Int? = null)
@Serializable data class TotalsLine(val total: Double, val subtotal: Double? = null)
@Serializable data class TotalsVat(val rate: Double, val base: Double, val vat: Double)
@Serializable data class DocumentTotals(val lines: List<TotalsLine>, val total_net: Double, val total_vat: Double, val rounding: Double, val total: Double, val vat: List<TotalsVat>)
@Serializable data class SearchHit(val resource: String, val resourceLabel: String, val id: Int, val label: String)

@Serializable data class ReportColumn(val label: String, val type: String, val term: String? = null) {
    val isNumeric get() = type == "money" || type == "number"
}
@Serializable data class ReportRow(val cells: List<JsonElement>, val style: String? = null, val indent: Int? = null, val link: RecordRef? = null)
@Serializable data class ReportTable(val title: String? = null, val columns: List<ReportColumn>, val rows: List<ReportRow>)
@Serializable data class ReportSummary(val label: String, val value: Double, val tone: String? = null)
@Serializable data class ReportScreen(val id: String, val title: String, val subtitle: String, val params: String, val summary: List<ReportSummary> = emptyList(), val tables: List<ReportTable>, val balanced: Boolean? = null, val pdf: String? = null)

@Serializable data class SettingsForm(val fields: List<FieldDef>, val values: JsonObject)
@Serializable data class SettingsForms(val company: SettingsForm, val accounting: SettingsForm, val texts: SettingsForm)
@Serializable data class NumberFormat(val key: String, val label: String, val format: String, val next_value: Int, val preview: String)
@Serializable data class SettingsScreen(val forms: SettingsForms, val numbering: List<NumberFormat>, val inbox: String? = null, val agent: Boolean = false, val canWrite: Boolean = false)
@Serializable data class Member(val user_id: String, val email: String, val name: String, val role: String)
@Serializable data class Invitation(val id: String, val email: String, val role: String)
@Serializable data class TeamScreen(val members: List<Member>, val invitations: List<Invitation>, val me: String? = null, val canWrite: Boolean = false)
@Serializable data class ApiKeyInfo(val id: String, val name: String, val prefix: String, val scope: String, val role: String, val user_name: String, val revoked_at: String? = null)
@Serializable data class CreatedApiKey(val key: String, val id: String, val message: String)
@Serializable data class InviteResult(val added: Boolean, val link: String? = null, val message: String)
@Serializable data class MessageResult(val message: String)
@Serializable data class BankImportResult(val imported: Int, val duplicates: Int, val suggested: Int, val booked: Int)
@Serializable data class PayrollResult(val created: Int, val skipped: Int = 0)
