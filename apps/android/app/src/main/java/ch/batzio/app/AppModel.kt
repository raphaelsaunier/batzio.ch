package ch.batzio.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation3.runtime.NavKey
import ch.batzio.app.core.AccountInfo
import ch.batzio.app.core.Api
import ch.batzio.app.core.ApiException
import ch.batzio.app.core.AppTarget
import ch.batzio.app.core.AuthResult
import ch.batzio.app.core.Bootstrap
import ch.batzio.app.core.Company
import ch.batzio.app.core.DropOutcome
import ch.batzio.app.core.I18n
import ch.batzio.app.core.L
import ch.batzio.app.core.NavItem
import ch.batzio.app.core.Preferences
import ch.batzio.app.core.RecordRef
import ch.batzio.app.core.SessionStore
import ch.batzio.app.core.UploadFile
import ch.batzio.app.core.obj
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/** Session, company, navigation and everything screens share. */
class AppModel(application: Application) : AndroidViewModel(application) {
    enum class Phase { SignedOut, ChoosingCompany, Loading, Ready, Failed }
    data class Toast(val id: Long, val text: String, val tone: String = "success")

    private val store = SessionStore(application, BuildConfig.DEFAULT_SERVER)
    var prefs by mutableStateOf(store.load()); private set
    private var token by mutableStateOf(store.token)
    var phase by mutableStateOf(Phase.SignedOut); private set
    var failure by mutableStateOf<String?>(null); private set
    var bootstrap by mutableStateOf<Bootstrap?>(null); private set
    var selected by mutableStateOf<String?>(null); private set
    /** Bumped after changes so open screens reload. */
    var revision by mutableIntStateOf(0); private set
    val toasts = mutableStateListOf<Toast>()
    val backStack = mutableStateListOf<NavKey>(Home(AppTarget("today")))
    val batzi = BatziModel(this)

    val locale: String get() = prefs.locale ?: I18n.preferred()
    val tenantSlug: String get() = prefs.tenant ?: ""
    val isAccountant: Boolean get() = prefs.mode == "accountant"
    val api: Api get() = Api(prefs.serverUrl, token, prefs.tenant, locale, prefs.mode)

    init {
        I18n.load(application)
        I18n.locale = locale
        if (token != null) {
            phase = if (prefs.tenant == null) Phase.ChoosingCompany else Phase.Loading
            viewModelScope.launch { start() }
        }
    }

    /**
     * Debug builds accept launch extras for automated screenshots, e.g.
     * `adb shell am start -n ch.batzio.app/.MainActivity --es batzioToken … --es batzioTenant acme --es batzioLocale de --es batzioOpen invoices`.
     */
    fun debugLaunch(extras: android.os.Bundle?) {
        if (!BuildConfig.DEBUG || extras == null) return
        extras.getString("batzioServer")?.let { v -> update { it.copy(serverUrl = v) } }
        extras.getString("batzioLocale")?.let { v -> update { it.copy(locale = v) } }
        extras.getString("batzioTenant")?.let { v -> update { it.copy(tenant = v) } }
        val open = extras.getString("batzioOpen")
        extras.getString("batzioToken")?.let { t ->
            token = t
            store.token = t
            phase = Phase.Loading
            viewModelScope.launch {
                start()
                delay(300)
                when {
                    open == null -> Unit
                    open == "batzi" -> push(BatziRoute)
                    open.startsWith("record:") -> open.split(":").let { push(RecordRoute(it[1], it[2].toInt())) }
                    open.startsWith("new:") -> push(FormRoute(open.removePrefix("new:")))
                    open.startsWith("report:") -> push(ReportRoute(open.removePrefix("report:")))
                    open == "reports" -> go(AppTarget("reports"))
                    open == "settings" -> go(AppTarget("settings"))
                    open == "today" -> go(AppTarget("today"))
                    else -> go(AppTarget("resource", resource = open))
                }
            }
        }
    }

    fun update(change: (Preferences) -> Preferences) {
        prefs = change(prefs)
        store.save(prefs)
        I18n.locale = locale
    }

    // ------------------------------------------------------------ session

    suspend fun start() {
        if (token == null) { phase = Phase.SignedOut; return }
        try {
            val account: AccountInfo = api.get("/auth/me")
            update { it.copy(user = account.user, companies = account.companies) }
            if (prefs.tenant == null || account.companies.none { it.slug == prefs.tenant }) {
                if (account.companies.size == 1) update { it.copy(tenant = account.companies[0].slug) } else { phase = Phase.ChoosingCompany; return }
            }
            reload()
        } catch (e: ApiException) {
            if (e.isUnauthorized) signOut() else { failure = e.message; phase = Phase.Failed }
        }
    }

    private suspend fun signedIn(result: AuthResult) {
        token = result.token
        store.token = result.token
        update {
            it.copy(
                user = result.user,
                companies = result.companies,
                locale = it.locale ?: result.user.locale?.takeIf { l -> l in I18n.supported },
                tenant = result.companies.singleOrNull()?.slug,
            )
        }
        if (prefs.tenant == null) phase = Phase.ChoosingCompany else { phase = Phase.Loading; reload() }
    }

    suspend fun signIn(email: String, password: String) {
        signedIn(api.send("POST", "/auth/login", obj("email" to email, "password" to password)))
    }

    suspend fun signUp(name: String, email: String, password: String, company: String, language: String, demo: Boolean) {
        signedIn(api.send("POST", "/auth/signup", obj("name" to name, "email" to email, "password" to password, "company" to company, "language" to language, "demo" to demo)))
    }

    fun signOut() {
        val current = api
        viewModelScope.launch { runCatching { current.send<JsonElement>("POST", "/auth/logout") } }
        token = null
        store.token = null
        update { it.copy(tenant = null, user = null, companies = emptyList()) }
        bootstrap = null
        selected = null
        resetStack(Home(AppTarget("today")))
        batzi.reset()
        phase = Phase.SignedOut
    }

    fun choose(company: Company) {
        update { it.copy(tenant = company.slug) }
        bootstrap = null
        selected = null
        batzi.reset()
        resetStack(Home(AppTarget("today")))
        phase = Phase.Loading
        viewModelScope.launch { reload() }
    }

    /** Loads (or reloads) navigation and every module definition. */
    suspend fun reload() {
        try {
            val b: Bootstrap = api.get("/app/bootstrap", mapOf("mode" to prefs.mode))
            bootstrap = b
            val items = b.navigation.flatMap { it.items }
            if (selected == null || items.none { it.key == selected }) {
                items.firstOrNull()?.let { select(it) }
            }
            phase = Phase.Ready
            revision++
        } catch (e: ApiException) {
            if (e.isUnauthorized) signOut()
            else if (bootstrap == null) { failure = e.message; phase = Phase.Failed } else toast(e.message, "danger")
        }
    }

    fun setLocale(value: String?) {
        update { it.copy(locale = value) }
        viewModelScope.launch {
            if (value != null) runCatching { api.send<JsonElement>("PATCH", "/auth/me", obj("locale" to value)) }
            reload()
        }
    }

    fun setMode(mode: String) {
        update { it.copy(mode = mode) }
        viewModelScope.launch { reload() }
    }

    // ------------------------------------------------------------ navigation

    private fun resetStack(root: NavKey) {
        backStack.clear()
        backStack.add(root)
    }

    fun select(item: NavItem) {
        selected = item.key
        resetStack(Home(item.target, item.title))
    }

    /** Opens a destination: sidebar ones reset the stack, the rest push. */
    fun go(target: AppTarget) {
        val items = bootstrap?.navigation?.flatMap { it.items } ?: emptyList()
        val match = items.firstOrNull { it.target == target } ?: items.firstOrNull { item -> item.tabs.any { it.target == target } }
        if (match != null && target.id == null && target.create != true) {
            selected = match.key
            resetStack(Home(target, match.title))
            return
        }
        push(routeFor(target))
    }

    fun routeFor(target: AppTarget): NavKey = when (target.kind) {
        "resource" -> when {
            target.id != null -> RecordRoute(target.resource!!, target.id)
            target.create == true -> FormRoute(target.resource!!)
            else -> ListRoute(target.resource!!)
        }
        "reports" -> target.report?.let { ReportRoute(it) } ?: Home(target)
        "file" -> FileRoute(target.id ?: 0)
        else -> Home(target)
    }

    fun push(route: NavKey) { backStack.add(route) }
    fun pop() { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) }
    fun open(ref: RecordRef) = push(RecordRoute(ref.resource, ref.id))

    // ------------------------------------------------------------ feedback

    fun toast(text: String, tone: String = "success") {
        val t = Toast(System.nanoTime(), text, tone)
        toasts.add(t)
        viewModelScope.launch {
            delay(4000)
            toasts.remove(t)
        }
    }

    fun report(e: Throwable) = toast(e.message ?: e.toString(), "danger")
    fun changed() { revision++ }

    /** Files shared, picked or dropped: handled at once where possible, else queued for Batzi. */
    fun drop(files: List<UploadFile>) {
        if (files.isEmpty() || phase != Phase.Ready) return
        toast(L("Got it — reading {n} file(s)…", "n" to files.size), "info")
        viewModelScope.launch {
            try {
                val outcomes: List<DropOutcome> = api.upload("/api/drop", files)
                outcomes.forEach { toast(it.text ?: it.file.name, if (it.handled) "success" else "info") }
                changed()
            } catch (e: Exception) {
                report(e)
            }
        }
    }
}
