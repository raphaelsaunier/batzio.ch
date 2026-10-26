package ch.batzio.app.ui.theme

import android.graphics.BlurMaskFilter
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Neumorphism is for pages, cards and buttons only. Text fields keep Material's plain look.

private fun DrawScope.softShadows(layers: List<BzShadowLayer>, t: BzScheme, radius: Float, inset: Boolean) {
    drawIntoCanvas { canvas ->
        for (l in layers) {
            val paint = Paint()
            val frame = paint.asFrameworkPaint()
            frame.color = l.color(t).toArgb()
            frame.maskFilter = BlurMaskFilter(l.blur.dp.toPx() / 2f + 0.5f, if (inset) BlurMaskFilter.Blur.INNER else BlurMaskFilter.Blur.NORMAL)
            canvas.save()
            canvas.translate(l.x.dp.toPx(), l.y.dp.toPx())
            canvas.drawRoundRect(0f, 0f, size.width, size.height, radius, radius, paint)
            canvas.restore()
        }
    }
}

/** A raised, softly extruded card on the page surface. */
@Composable
fun Modifier.neuCard(radius: Dp = BzRadius.xl, padding: Dp = BzSpace.lg): Modifier {
    val t = LocalBz.current
    val dark = t == BzDark
    val shadows = if (dark) BzShadows.neuRaised.dark else BzShadows.neuRaised.light
    return this
        .drawBehind { softShadows(shadows, t, radius.toPx(), inset = false) }
        .clip(RoundedCornerShape(radius))
        .background(t.neuSurface)
        .padding(padding)
}

/** Soft raised button that sinks in when pressed; `prominent` gets the minted-metal gradient. */
@Composable
fun NeuButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    prominent: Boolean = false,
    compact: Boolean = false,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
) {
    val t = LocalBz.current
    val dark = t == BzDark
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(50)
    val set = if (pressed) BzShadows.neuPressed else BzShadows.neuRaisedSm
    val layers = if (dark) set.dark else set.light
    Box(
        modifier
            .scale(if (pressed) 0.98f else 1f)
            .alpha(if (enabled) 1f else 0.5f)
            .drawBehind { if (!prominent && !pressed) softShadows(layers, t, size.height / 2, inset = false) }
            .clip(shape)
            .background(if (prominent) Brush.linearGradient(BzGradient.metal(t), start = Offset.Zero, end = Offset.Infinite) else Brush.linearGradient(listOf(t.neuSurface, t.neuSurface)))
            .drawBehind { if (!prominent && pressed) softShadows(layers, t, size.height / 2, inset = true) }
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(if (compact) PaddingValues(horizontal = 12.dp, vertical = 6.dp) else PaddingValues(horizontal = 18.dp, vertical = 10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            leading?.invoke()
            Text(
                text,
                style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = if (prominent) t.primaryForeground else t.foreground,
            )
        }
    }
}

fun toneColor(t: BzScheme, tone: String?): Color = when (tone) {
    "success" -> t.success
    "warning" -> t.warning
    "danger" -> t.destructive
    "info" -> t.info
    "primary" -> t.primary
    else -> t.mutedForeground
}

/** A small coloured label for statuses (tones match the web badges). */
@Composable
fun ToneBadge(text: String, tone: String?) {
    val t = LocalBz.current
    val c = toneColor(t, tone)
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        color = c,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

