package ch.batzio.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.PermanentNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import ch.batzio.app.AppModel
import ch.batzio.app.BatziRoute
import ch.batzio.app.FileRoute
import ch.batzio.app.FormRoute
import ch.batzio.app.Home
import ch.batzio.app.ListRoute
import ch.batzio.app.R
import ch.batzio.app.RecordRoute
import ch.batzio.app.ReportRoute
import ch.batzio.app.SettingsPage
import ch.batzio.app.core.AppTarget
import ch.batzio.app.core.L
import ch.batzio.app.ui.components.EmptyState
import ch.batzio.app.ui.components.ErrorState
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.bzIcon
import ch.batzio.app.ui.theme.neuCard
import ch.batzio.app.ui.theme.toneColor
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

@Composable
fun Root(app: AppModel) {
    Box(Modifier.fillMaxSize().background(LocalBz.current.background)) {
        when (app.phase) {
            AppModel.Phase.SignedOut -> WelcomeScreen(app)
            AppModel.Phase.ChoosingCompany -> CompanyPicker(app)
            AppModel.Phase.Loading -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Coin(size = 110.dp)
                Spacer(Modifier.height(16.dp))
                CircularProgressIndicator()
            }
            AppModel.Phase.Failed -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
                ErrorState(app.failure ?: "") { app.viewModelScopeLaunch { app.start() } }
                TextButton({ app.signOut() }, Modifier.align(Alignment.CenterHorizontally)) { Text(L("Sign out")) }
            }
            AppModel.Phase.Ready -> MainShell(app)
        }
        Toasts(app, Modifier.align(Alignment.BottomCenter))
    }
}

fun AppModel.viewModelScopeLaunch(block: suspend () -> Unit) {
    viewModelScope.launch { block() }
}

@Composable
private fun Toasts(app: AppModel, modifier: Modifier) {
    Column(modifier.navigationBarsPadding().padding(16.dp).widthIn(max = 520.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        app.toasts.forEach { t ->
            AnimatedVisibility(visible = true, enter = fadeIn() + slideInVertically { it }) {
                Row(Modifier.neuCard(radius = 16.dp, padding = 14.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).background(toneColor(LocalBz.current, t.tone), MaterialTheme.shapes.small))
                    Spacer(Modifier.width(10.dp))
                    Text(t.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun MainShell(app: AppModel) {
    BoxWithConstraints {
        val wide = maxWidth >= 840.dp
        val scope = rememberCoroutineScope()
        val drawer = rememberDrawerState(DrawerValue.Closed)
        val content = @Composable {
            NavHost(app, wide) { scope.launch { drawer.open() } }
        }
        if (wide) {
            PermanentNavigationDrawer(drawerContent = { PermanentDrawerSheet(Modifier.width(280.dp)) { Sidebar(app) {} } }) { content() }
        } else {
            ModalNavigationDrawer(drawerState = drawer, drawerContent = { ModalDrawerSheet { Sidebar(app) { scope.launch { drawer.close() } } } }) { content() }
        }
    }
}

@Composable
private fun Sidebar(app: AppModel, onPicked: () -> Unit) {
    val b = app.bootstrap ?: return
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(12.dp)) {
            Image(painterResource(R.drawable.coin_front), null, Modifier.size(36.dp))
            Spacer(Modifier.width(10.dp))
            Column {
                Text(b.tenant.name, style = MaterialTheme.typography.titleMedium)
                if (app.prefs.companies.size > 1) TextButton({ app.update { it.copy(tenant = null) }; app.choose(app.prefs.companies.first { c -> c.slug != b.tenant.slug }) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text(L("Switch company")) }
            }
        }
        b.navigation.forEach { section ->
            if (section.label.isNotEmpty()) Text(section.label, style = MaterialTheme.typography.labelMedium, color = LocalBz.current.mutedForeground, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
            section.items.forEach { item ->
                NavigationDrawerItem(
                    label = { Text(item.title) },
                    icon = { Icon(bzIcon(item.icon), null) },
                    selected = app.selected == item.key,
                    onClick = { app.select(item); onPicked() },
                )
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(L("Accountant goggles"), style = MaterialTheme.typography.titleSmall)
                Text(L("Classic terms, every module"), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
            }
            Switch(app.isAccountant, { app.setMode(if (it) "accountant" else "simple") })
        }
        app.prefs.user?.let { u ->
            Column(Modifier.padding(16.dp)) {
                Text(u.name, style = MaterialTheme.typography.titleSmall)
                Text(u.email, style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
            }
        }
    }
}

/** Every screen, by route. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NavHost(app: AppModel, wide: Boolean, openDrawer: () -> Unit) {
    NavDisplay(
        backStack = app.backStack,
        onBack = { app.pop() },
        entryProvider = entryProvider {
            entry<Home> { key -> Screen(app, key.title.ifEmpty { "Batzio" }, wide, openDrawer, root = true) { TargetScreen(app, key.target, key.title) } }
            entry<ListRoute> { key -> ResourceListScreen(app, key.resource) }
            entry<RecordRoute> { key -> RecordScreenView(app, key.resource, key.id) }
            entry<FormRoute> { key -> RecordFormScreen(app, key.resource, key.id, key.prefill) }
            entry<ReportRoute> { key -> ReportScreenView(app, key.id) }
            entry<FileRoute> { key -> FileScreen(app, key.id, key.name) }
            entry<BatziRoute> { BatziScreen(app) }
            entry<SettingsPage> { key -> SettingsPageScreen(app, key.page) }
        },
    )
}

@Composable
fun TargetScreen(app: AppModel, target: AppTarget, title: String) {
    when (target.kind) {
        "today" -> TodayScreenView(app)
        "reports" -> if (target.report != null) ReportBody(app, target.report) else ReportsScreen(app)
        "resource" -> ResourceListBody(app, target.resource ?: "", app.bootstrap?.navigation?.flatMap { it.items }?.firstOrNull { it.target == target }?.tabs.orEmpty())
        "bank_import" -> BankImportScreen(app)
        "payroll" -> PayrollScreen(app)
        "settings" -> SettingsScreenView(app)
        else -> EmptyState(target.href ?: title)
    }
}

/** A page with a top bar, Batzi button and (for roots) the menu. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Screen(
    app: AppModel,
    title: String,
    wide: Boolean = false,
    openDrawer: (() -> Unit)? = null,
    root: Boolean = false,
    actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
    content: @Composable () -> Unit,
) {
    Scaffold(
        containerColor = LocalBz.current.background,
        topBar = {
            androidx.compose.material3.TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    if (root && !wide && openDrawer != null) IconButton(openDrawer) { Icon(Icons.Outlined.Menu, L("Menu")) }
                    else if (!root) IconButton({ app.pop() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, L("Back")) }
                },
                actions = {
                    actions()
                    IconButton({ app.push(BatziRoute) }) { Icon(Icons.Outlined.AutoAwesome, L("Ask Batzi"), tint = LocalBz.current.primary) }
                },
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(containerColor = LocalBz.current.background),
            )
        },
    ) { padding -> Box(Modifier.padding(padding).fillMaxSize()) { content() } }
}

