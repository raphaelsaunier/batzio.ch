package ch.batzio.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewModelScope
import ch.batzio.app.core.AgentEvent
import ch.batzio.app.core.ChatTurn
import ch.batzio.app.core.FileRef
import ch.batzio.app.core.L
import ch.batzio.app.core.StoredFile
import ch.batzio.app.core.ThreadSummary
import ch.batzio.app.core.ToolOutcome
import ch.batzio.app.core.UploadFile
import ch.batzio.app.core.json
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** A conversation with Batzi, streamed live from `/api/agent`. */
class BatziModel(private val app: AppModel) {
    data class Message(
        val id: Long = System.nanoTime(),
        val role: String,
        val text: String = "",
        val files: List<FileRef> = emptyList(),
        val updates: List<String> = emptyList(),
        val tools: List<ToolOutcome> = emptyList(),
        val refused: Boolean = false,
        val streaming: Boolean = false,
    )

    val messages = mutableStateListOf<Message>()
    var threadId by mutableStateOf<String?>(null); private set
    var working by mutableStateOf(false); private set
    val attachments = mutableStateListOf<FileRef>()
    var uploading by mutableStateOf(false); private set
    var threads by mutableStateOf<List<ThreadSummary>>(emptyList()); private set

    fun reset() {
        messages.clear()
        attachments.clear()
        threadId = null
        working = false
    }

    fun loadThreads() = app.viewModelScope.launch {
        threads = runCatching { app.api.get<List<ThreadSummary>>("/app/threads") }.getOrDefault(emptyList())
    }

    fun load(thread: String) = app.viewModelScope.launch {
        try {
            val turns: List<ChatTurn> = app.api.get("/app/threads/$thread")
            threadId = thread
            messages.clear()
            messages.addAll(turns.map { Message(role = it.role, text = it.text, files = it.files ?: emptyList(), tools = it.tools ?: emptyList(), refused = it.refused ?: false) })
        } catch (e: Exception) {
            app.report(e)
        }
    }

    fun attach(files: List<UploadFile>) = app.viewModelScope.launch {
        if (files.isEmpty()) return@launch
        uploading = true
        try {
            val stored: List<StoredFile> = app.api.upload("/api/drop", files, query = mapOf("store" to "1"))
            attachments.addAll(stored.map { it.file })
        } catch (e: Exception) {
            app.report(e)
        } finally {
            uploading = false
        }
    }

    fun send(text: String) {
        val files = attachments.toList()
        attachments.clear()
        messages.add(Message(role = "user", text = text, files = files))
        stream(mapOf("threadId" to threadId, "text" to text, "fileIds" to files.map { it.id }, "page" to "/${app.tenantSlug}"))
    }

    /** Lets Batzi take care of an inbox item (a dropped file or forwarded mail). */
    fun process(fileId: Int?, inboxId: Int?, prompt: String?) {
        val text = prompt ?: L("Take care of this, please.")
        messages.add(Message(role = "user", text = text))
        stream(mapOf("threadId" to threadId, "text" to text, "fileIds" to listOfNotNull(fileId), "inboxIds" to listOfNotNull(inboxId)))
    }

    fun confirm(tool: ToolOutcome, approve: Boolean) = stream(mapOf("threadId" to threadId, "confirm" to mapOf("toolUseId" to tool.id, "approve" to approve)))

    private fun stream(body: Map<String, Any?>) {
        working = true
        messages.add(Message(role = "assistant", streaming = true))
        val index = messages.lastIndex
        fun edit(change: (Message) -> Message) { if (index in messages.indices) messages[index] = change(messages[index]) }
        app.viewModelScope.launch {
            try {
                app.api.agent(JsonObject(body.filterValues { it != null }.mapValues { json(it.value) })).collect { e ->
                    when (e) {
                        is AgentEvent.Thread -> threadId = e.id
                        is AgentEvent.Text -> edit { it.copy(text = it.text + e.delta) }
                        is AgentEvent.Update -> edit { it.copy(updates = it.updates + e.text) }
                        is AgentEvent.Tool -> edit { m -> m.copy(tools = m.tools.filterNot { it.id == e.outcome.id } + e.outcome) }
                        is AgentEvent.Done -> edit { it.copy(refused = e.refused) }
                        is AgentEvent.Error -> edit {
                            it.copy(text = it.text + when {
                                e.message != "no_agent" -> e.message
                                app.isOnDevice -> L("Batzi needs an internet connection. On this device, quick sentences and file drops still work.")
                                else -> L("Batzi needs an Anthropic API key on the server before it can chat. Quick sentences and file drops still work.")
                            })
                        }
                    }
                }
            } catch (e: Exception) {
                edit { it.copy(text = it.text + (e.message ?: "")) }
            } finally {
                edit { it.copy(streaming = false) }
                working = false
                app.changed()
            }
        }
    }
}
