package ch.batzio.app.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.batzio.app.AppModel
import ch.batzio.app.R
import ch.batzio.app.core.L
import ch.batzio.app.ui.theme.BzGradient
import ch.batzio.app.ui.theme.Display
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.neuCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.cos

/** The Batzio coin: tossed, spinning a few times, landing flat with a soft shadow. Tap to flip. */
@Composable
fun Coin(size: Dp = 180.dp, autoplay: Boolean = true) {
    val angle = remember { Animatable(0f) }
    val lift = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        if (!autoplay) return@LaunchedEffect
        delay(250)
        launch { angle.animateTo(360f * 5, tween(2400, easing = CubicBezierEasing(0.15f, 0.7f, 0.25f, 1f))) }
        lift.animateTo(1f, tween(900))
        lift.animateTo(0f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessLow))
    }
    val c = cos(Math.toRadians(angle.value.toDouble())).toFloat()
    Box(Modifier.size(size, size * 1.25f), contentAlignment = Alignment.Center) {
        // Shadow on the "table": a soft ellipse, tight and darker once the coin has landed.
        Canvas(Modifier.align(Alignment.BottomCenter).size(size, size * 0.14f)) {
            val radius = this.size.width * (0.4f - 0.15f * lift.value)
            scale(1f, this.size.height / (radius * 2), pivot = center) {
                drawCircle(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.32f - 0.22f * lift.value), Color.Transparent), center, radius), radius, center)
            }
        }
        Image(
            painterResource(if (c >= 0) R.drawable.coin_front else R.drawable.coin_back),
            contentDescription = "Batzio",
            modifier = Modifier
                .size(size)
                .graphicsLayer {
                    scaleX = maxOf(abs(c), 0.03f)
                    translationY = -lift.value * size.toPx() * 0.45f
                    rotationX = 18f * lift.value
                    cameraDistance = 12 * density
                }
                .clip(CircleShape)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                    scope.launch { angle.animateTo(angle.value + 180f, spring(dampingRatio = 0.7f)) }
                },
        )
    }
}

/** “Accounting Suite” gets crossed out and becomes “Accounting, Sweet!”. */
@Composable
fun CoinTagline() {
    var phase by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        delay(2600); phase = 1
        delay(900); phase = 2
        delay(650); phase = 3
    }
    val t = LocalBz.current
    Box(contentAlignment = Alignment.Center, modifier = Modifier.height(44.dp)) {
        if (phase in 1..2) Text("Accounting Suite", fontFamily = Display, fontSize = 26.sp, color = t.mutedForeground, textDecoration = if (phase == 2) TextDecoration.LineThrough else null)
        if (phase == 3) Text("Accounting, Sweet!", fontFamily = Display, fontSize = 28.sp, style = MaterialTheme.typography.headlineMedium.copy(brush = Brush.linearGradient(BzGradient.metal(t), start = Offset.Zero, end = Offset(600f, 0f))))
    }
}

@Composable
fun WelcomeScreen(app: AppModel) {
    var tab by remember { mutableIntStateOf(0) }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Coin(170.dp)
        CoinTagline()
        Text(
            L("Born from a deep aversion to accounting. Drop a receipt, say what happened, Batzi does the books."),
            style = MaterialTheme.typography.bodyLarge, color = LocalBz.current.mutedForeground, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 440.dp),
        )
        ExperimentNotice()
        Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().neuCard(padding = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf(L("Sign in"), L("Create account")).forEachIndexed { i, label ->
                    SegmentedButton(tab == i, { tab = i }, SegmentedButtonDefaults.itemShape(i, 2)) { Text(label, maxLines = 1) }
                }
            }
            when (tab) {
                0 -> SignInForm(app)
                1 -> SignUpForm(app)
                else -> DeviceForm(app)
            }
        }
        if (tab != 2) {
            // Working without a server is its own path, not a third way to sign in.
            TextButton({ tab = 2 }) {
                Icon(Icons.Outlined.PhoneAndroid, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(L("On this device"))
            }
            ServerField(app)
        }
    }
}

@Composable
private fun SignInForm(app: AppModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    OutlinedTextField(email, { email = it }, label = { Text(L("Email")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(password, { password = it }, label = { Text(L("Password")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
    error?.let { Text(it, color = LocalBz.current.destructive) }
    NeuButton(L("Sign in"), {
        scope.launch {
            busy = true
            try { app.signIn(email.trim(), password) } catch (e: Exception) { error = e.message } finally { busy = false }
        }
    }, prominent = true, enabled = !busy && email.isNotBlank() && password.isNotEmpty(), modifier = Modifier.fillMaxWidth())
}

@Composable
private fun SignUpForm(app: AppModel) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var company by remember { mutableStateOf("") }
    var demo by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val language = if (app.locale == "en") "de" else app.locale
    OutlinedTextField(name, { name = it }, label = { Text(L("Your name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(email, { email = it }, label = { Text(L("Email")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(password, { password = it }, label = { Text(L("Password (at least 10 characters)")) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(company, { company = it }, label = { Text(L("Company name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(demo, { demo = it })
        Text(L("Start with demo data"))
    }
    error?.let { Text(it, color = LocalBz.current.destructive) }
    NeuButton(L("Create account"), {
        scope.launch {
            busy = true
            try { app.signUp(name, email.trim(), password, company, language, demo) } catch (e: Exception) { error = e.message } finally { busy = false }
        }
    }, prominent = true, enabled = !busy && name.isNotBlank() && email.isNotBlank() && password.length >= 10 && company.isNotBlank(), modifier = Modifier.fillMaxWidth())
}

/** Batzio is an experiment, not a product to trust with real books. */
@Composable
fun ExperimentNotice() {
    val t = LocalBz.current
    Row(
        Modifier.widthIn(max = 440.dp).clip(RoundedCornerShape(12.dp)).background(t.warning.copy(alpha = 0.16f)).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Science, null, tint = t.warning, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(L("Batzio is a vibe-coding experiment.")) }
                append(" ")
                append(L("Don’t use it for real data — and please don’t sue us."))
            },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/** Works without a server: SQLite files on this device, no account, no internet. */
@Composable
private fun DeviceForm(app: AppModel) {
    var name by remember { mutableStateOf("") }
    var company by remember { mutableStateOf("") }
    var demo by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val language = if (app.locale == "en") "de" else app.locale
    fun run(work: suspend () -> Unit) = scope.launch {
        busy = true
        try { work() } catch (e: Exception) { error = e.message } finally { busy = false }
    }
    Text(
        L("Everything stays on this device: no account and no internet needed. Batzi, the assistant, needs a connection and is off here."),
        style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground,
    )
    if (app.hasDeviceData) {
        error?.let { Text(it, color = LocalBz.current.destructive) }
        NeuButton(L("Continue on this device"), { run { app.continueOnDevice() } }, prominent = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
        return
    }
    OutlinedTextField(name, { name = it }, label = { Text(L("Your name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(company, { company = it }, label = { Text(L("Company name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(demo, { demo = it })
        Text(L("Start with demo data"))
    }
    error?.let { Text(it, color = LocalBz.current.destructive) }
    NeuButton(L("Start on this device"), { run { app.startOnDevice(name.trim(), company.trim(), language, demo) } }, prominent = true, enabled = !busy && name.isNotBlank() && company.isNotBlank(), modifier = Modifier.fillMaxWidth())
}

@Composable
private fun ServerField(app: AppModel) {
    var editing by remember { mutableStateOf(false) }
    var value by remember { mutableStateOf(app.prefs.serverUrl) }
    if (editing) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.widthIn(max = 440.dp)) {
            OutlinedTextField(value, { value = it }, label = { Text(L("Server address")) }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            TextButton({ app.update { it.copy(serverUrl = value.trim()) }; editing = false }) { Text(L("Save")) }
        }
    } else {
        TextButton({ editing = true }) { Text(app.prefs.serverUrl, color = LocalBz.current.mutedForeground, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
fun CompanyPicker(app: AppModel) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        Image(painterResource(R.drawable.coin_front), null, Modifier.size(90.dp))
        Text(L("Which company today?"), style = MaterialTheme.typography.headlineMedium)
        app.prefs.companies.forEach { c -> NeuButton(c.name, { app.choose(c) }, modifier = Modifier.widthIn(min = 260.dp)) }
        if (app.prefs.companies.isEmpty()) Text(L("You are not part of any company yet."), color = LocalBz.current.mutedForeground)
        Spacer(Modifier.height(8.dp))
        TextButton({ app.signOut() }) { Text(L("Sign out")) }
    }
}
