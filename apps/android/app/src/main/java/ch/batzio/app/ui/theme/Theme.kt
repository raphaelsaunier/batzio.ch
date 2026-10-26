package ch.batzio.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ch.batzio.app.R

/** The current appearance's design tokens (generated from packages/tokens). */
val LocalBz = staticCompositionLocalOf { BzLight }

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, vararg weights: Int) = FontFamily(
    weights.map { w -> Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) },
)

val Display = variable(R.font.bricolage_grotesque, 400, 500, 600, 700, 800)
val Sans = variable(R.font.inter, 400, 500, 600, 700)

private fun typography() = Typography().run {
    copy(
        displayLarge = displayLarge.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        displayMedium = displayMedium.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        displaySmall = displaySmall.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        headlineLarge = headlineLarge.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        headlineMedium = headlineMedium.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        headlineSmall = headlineSmall.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        titleLarge = titleLarge.copy(fontFamily = Display, fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.copy(fontFamily = Sans, fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.copy(fontFamily = Sans, fontWeight = FontWeight.SemiBold),
        bodyLarge = bodyLarge.copy(fontFamily = Sans),
        bodyMedium = bodyMedium.copy(fontFamily = Sans),
        bodySmall = bodySmall.copy(fontFamily = Sans),
        labelLarge = labelLarge.copy(fontFamily = Sans, fontWeight = FontWeight.SemiBold),
        labelMedium = labelMedium.copy(fontFamily = Sans),
        labelSmall = labelSmall.copy(fontFamily = Sans),
    )
}

val NumberStyle = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum", fontSize = 15.sp)

@Composable
fun BatzioTheme(appearance: String = "system", content: @Composable () -> Unit) {
    val dark = when (appearance) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    val t = if (dark) BzDark else BzLight
    val colors = if (dark) {
        darkColorScheme(
            primary = t.primary, onPrimary = t.primaryForeground, primaryContainer = t.accent, onPrimaryContainer = t.accentForeground,
            secondaryContainer = t.accent, onSecondaryContainer = t.accentForeground, tertiary = t.info, onTertiary = t.primaryForeground,
            tertiaryContainer = t.accent, onTertiaryContainer = t.accentForeground, surfaceTint = t.primary, outlineVariant = t.border, secondary = t.secondary, onSecondary = t.secondaryForeground,
            background = t.background, onBackground = t.foreground, surface = t.card, onSurface = t.cardForeground,
            surfaceVariant = t.muted, onSurfaceVariant = t.mutedForeground, error = t.destructive, outline = t.border,
            surfaceContainer = t.neuSurface, surfaceContainerHigh = t.secondary, surfaceContainerLow = t.background,
        )
    } else {
        lightColorScheme(
            primary = t.primary, onPrimary = t.primaryForeground, primaryContainer = t.accent, onPrimaryContainer = t.accentForeground,
            secondaryContainer = t.accent, onSecondaryContainer = t.accentForeground, tertiary = t.info, onTertiary = t.primaryForeground,
            tertiaryContainer = t.accent, onTertiaryContainer = t.accentForeground, surfaceTint = t.primary, outlineVariant = t.border, secondary = t.secondary, onSecondary = t.secondaryForeground,
            background = t.background, onBackground = t.foreground, surface = t.card, onSurface = t.cardForeground,
            surfaceVariant = t.muted, onSurfaceVariant = t.mutedForeground, error = t.destructive, outline = t.border,
            surfaceContainer = t.neuSurface, surfaceContainerHigh = t.secondary, surfaceContainerLow = t.background,
        )
    }
    CompositionLocalProvider(LocalBz provides t) {
        MaterialTheme(colorScheme = colors, typography = typography(), content = content)
    }
}
