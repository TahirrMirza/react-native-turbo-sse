import Foundation

class FastSse: HybridFastSseSpec {
    private var sessionDelegate: FastSseSessionDelegate?
    private var session: URLSession?
    private var dataTask: URLSessionDataTask?
    private var sseParser: SSEParser?
    private var closed = false
    
    public var readyState: Double = 0.0

    public func connect(
        url: String, 
        httpMethod: String, 
        headers: [String: String], 
        body: String, 
        connectTimeoutMs: Double,
        readTimeoutMs: Double,
        onOpen: @escaping () -> Void, 
        onMessage: @escaping (String, String, String) -> Void, 
        onError: @escaping (String) -> Void, 
        onClose: @escaping () -> Void
    ) throws -> Void {
        closed = false
        readyState = 0.0
        sseParser = SSEParser()
        
        guard let requestUrl = URL(string: url) else {
            onError("Invalid URL")
            readyState = 2.0
            return
        }
        
        var request = URLRequest(url: requestUrl)
        request.httpMethod = httpMethod
        for (key, value) in headers {
            request.addValue(value, forHTTPHeaderField: key)
        }
        
        let method = httpMethod.uppercased()
        if (method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE") && !body.isEmpty {
            request.httpBody = body.data(using: .utf8)
        }
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = connectTimeoutMs > 0 ? connectTimeoutMs / 1000.0 : .infinity
        // timeoutIntervalForResource sets a hard limit on the TOTAL time of the connection (including streaming time).
        // Since SSE is a long-lived stream, we must set this to infinity.
        config.timeoutIntervalForResource = .infinity
        
        self.sessionDelegate = FastSseSessionDelegate(fastSse: self)
        session = URLSession(configuration: config, delegate: self.sessionDelegate, delegateQueue: nil)
        dataTask = session?.dataTask(with: request)
        
        // Store callbacks as properties or use blocks safely. Since Nitro dispatches to JS directly, 
        // we map these blocks dynamically inside our delegate handling.
        // Wait, URLSessionDataDelegate methods don't have access to these blocks directly 
        // if they are local to `connect`. So we must store them.
        self.onOpenCallback = onOpen
        self.onMessageCallback = onMessage
        self.onErrorCallback = onError
        self.onCloseCallback = onClose
        
        dataTask?.resume()
    }

    public func disconnect() throws -> Void {
        closed = true
        readyState = 2.0
        dataTask?.cancel()
        session?.invalidateAndCancel()
        dataTask = nil
        session = nil
    }
    
    // Store callbacks
    private var onOpenCallback: (() -> Void)?
    private var onMessageCallback: ((String, String, String) -> Void)?
    private var onErrorCallback: ((String) -> Void)?
    private var onCloseCallback: (() -> Void)?

    // MARK: - URLSessionDataDelegate Handlers
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !closed else {
            completionHandler(.cancel)
            return
        }
        
        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
            // Optional: you might want to read error body here before failing, but standard SSE fails on non-200.
            readyState = 2.0
            onErrorCallback?("HTTP Error \(httpResponse.statusCode)")
            completionHandler(.cancel)
            return
        }
        
        readyState = 1.0
        onOpenCallback?()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !closed else { return }
        
        guard let chunk = String(data: data, encoding: .utf8) else { return }
        
        if let events = sseParser?.parse(chunk: chunk) {
            for event in events {
                if closed { break }
                onMessageCallback?(event.type, event.id, event.data)
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !closed else { return }
        readyState = 2.0
        
        if let error = error {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                // Task was cancelled manually
                onCloseCallback?()
            } else {
                onErrorCallback?(error.localizedDescription)
            }
        } else {
            onCloseCallback?()
        }
    }
}

class FastSseSessionDelegate: NSObject, URLSessionDataDelegate {
    weak var fastSse: FastSse?
    
    init(fastSse: FastSse) {
        self.fastSse = fastSse
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        fastSse?.urlSession(session, dataTask: dataTask, didReceive: response, completionHandler: completionHandler)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        fastSse?.urlSession(session, dataTask: dataTask, didReceive: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        fastSse?.urlSession(session, task: task, didCompleteWithError: error)
    }
}
