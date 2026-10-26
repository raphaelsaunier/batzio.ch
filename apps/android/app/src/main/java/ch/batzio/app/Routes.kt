package ch.batzio.app

import androidx.navigation3.runtime.NavKey
import ch.batzio.app.core.AppTarget
import kotlinx.serialization.Serializable

/** Screens on the back stack. Top-level destinations reset it. */
@Serializable data class Home(val target: AppTarget, val title: String = "") : NavKey
@Serializable data class ListRoute(val resource: String) : NavKey
@Serializable data class RecordRoute(val resource: String, val id: Int) : NavKey
@Serializable data class FormRoute(val resource: String, val id: Int? = null, val prefill: String? = null) : NavKey
@Serializable data class ReportRoute(val id: String) : NavKey
@Serializable data class FileRoute(val id: Int, val name: String? = null) : NavKey
@Serializable data object BatziRoute : NavKey
@Serializable data class SettingsPage(val page: String) : NavKey
