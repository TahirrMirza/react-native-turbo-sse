package com.margelo.nitro.fastsse
  
import com.facebook.proguard.annotations.DoNotStrip
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

@DoNotStrip
class FastSse : HybridFastSseSpec() {
  private val client = OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MILLISECONDS) // Important for SSE to not timeout
    .build()

  private var cachedConnectionClient: OkHttpClient? = null
  private var lastConnectTimeout: Double = -1.0
  private var lastReadTimeout: Double = -1.0

  private var currentSource: EventSource? = null
  private var closed = false
  private var _lastEventId: String = ""
  
  override var readyState: Double = 0.0

  override fun connect(
    url: String, 
    httpMethod: String, 
    headers: Map<String, String>, 
    body: String,
    connectTimeoutMs: Double,
    readTimeoutMs: Double,
    onOpen: () -> Unit,
    onMessage: (event: String, id: String, data: String) -> Unit,
    onError: (message: String) -> Unit,
    onClose: () -> Unit
  ) {
    currentSource?.cancel()
    closed = false
    readyState = 0.0

    val requestBuilder = Request.Builder().url(url)
    headers.forEach { (k, v) -> requestBuilder.addHeader(k, v) }
    
    val method = httpMethod.uppercase()
    if (method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE") {
      requestBuilder.method(method, body.toRequestBody())
    } else {
      requestBuilder.method(method, null)
    }

    if (cachedConnectionClient == null || lastConnectTimeout != connectTimeoutMs || lastReadTimeout != readTimeoutMs) {
      cachedConnectionClient = client.newBuilder()
        .connectTimeout(connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .readTimeout(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .build()
      lastConnectTimeout = connectTimeoutMs
      lastReadTimeout = readTimeoutMs
    }

    currentSource = EventSources.createFactory(cachedConnectionClient!!)
      .newEventSource(requestBuilder.build(), object : EventSourceListener() {
        override fun onOpen(es: EventSource, response: Response) {
          if (closed) return
          readyState = 1.0
          onOpen()
        }
        override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
          if (closed) return
          if (!id.isNullOrEmpty()) _lastEventId = id
          onMessage(type ?: "message", _lastEventId, data.trimEnd('\r', '\n'))
        }
        override fun onFailure(es: EventSource, t: Throwable?, response: Response?) {
          if (closed) return
          readyState = 2.0
          val errorDetail = t?.message ?: t?.toString() ?: "Connection failed with code ${response?.code}"
          onError(errorDetail)
        }
        override fun onClosed(es: EventSource) {
          if (closed) return
          readyState = 2.0
          onClose()
        }
      })
  }

  override fun disconnect() {
    closed = true
    readyState = 2.0
    currentSource?.cancel()
    currentSource = null
  }
}
