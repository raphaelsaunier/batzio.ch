package ch.batzio.app.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
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
        // Shadow on the "table": tight and darker once the coin has landed.
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .size(size * (0.8f - 0.3f * lift.value), size * 0.09f)
                .blur(10.dp)
                .alpha(0.35f - 0.25f * lift.value)
                .background(Color.Black, CircleShape),
        )
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
    var signingUp by remember { mutableStateOf(false) }
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
        Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().neuCard(padding = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(!signingUp, { signingUp = false }, SegmentedButtonDefaults.itemShape(0, 2)) { Text(L("Sign in")) }
                SegmentedButton(signingUp, { signingUp = true }, SegmentedButtonDefaults.itemShape(1, 2)) { Text(L("Create account")) }
            }
            if (signingUp) SignUpForm(app) else SignInForm(app)
        }
        ServerField(app)
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
