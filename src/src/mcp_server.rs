// In-app MCP server.
//
// Listens on a Unix-domain socket inside the app data directory and
// speaks newline-delimited JSON-RPC 2.0 (the same wire format MCP uses
// over stdio). The packaged `.mcpb` proxy bridges stdio to this socket
// so Claude Desktop talks to the running app rather than to a separate
// Node process reading files behind our back.
//
// Started/stopped explicitly by the Tauri commands at the bottom of
// the file. The `notifier` callback (set by `lib.rs`) lets us tell the
// running app "the meetings directory just changed" so the sidebar
// can refresh without waiting for a relaunch.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{oneshot, Mutex};

use crate::meetings::{
    self, FilterError, MeetingFilter, OatsFile, ScheduleArgs, ScheduleError,
};

const SOCKET_FILENAME: &str = "mcp.sock";
const MEETINGS_SUBDIR: &str = "meetings";
const FALLBACK_PROTOCOL_VERSION: &str = "2025-06-18";

// JSON-RPC error codes from the spec — only the ones we actually use.
const ERR_PARSE: i64 = -32700;
const ERR_INVALID_REQUEST: i64 = -32600;
const ERR_METHOD_NOT_FOUND: i64 = -32601;
const ERR_INVALID_PARAMS: i64 = -32602;
const ERR_INTERNAL: i64 = -32603;

// Fired after a write-mutating tool (currently just `schedule_meeting`)
// successfully alters the meetings directory. The host (lib.rs) wires
// this to a Tauri event the webview listens for so the sidebar can
// refresh in real time.
pub type Notifier = Arc<dyn Fn() + Send + Sync>;

// Per-connection context. Built once when the listener starts and
// passed by Arc through accept → connection → message → tool dispatch
// so handlers can both touch the meetings directory and emit
// notifications without re-resolving paths.
struct Context {
    meetings_dir: PathBuf,
    notifier: Option<Notifier>,
}

#[derive(Default)]
pub struct State {
    inner: Mutex<Option<RunningServer>>,
}

struct RunningServer {
    cancel: oneshot::Sender<()>,
    handle: JoinHandle<()>,
    socket_path: PathBuf,
}

impl State {
    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    // Starts the listener if it isn't already. Returns the socket
    // path. Idempotent — calling twice without a stop is a no-op.
    // `notifier` is invoked whenever a write-mutating tool succeeds;
    // pass `None` to opt out (tests, headless use).
    pub async fn start(
        &self,
        app_data_dir: PathBuf,
        notifier: Option<Notifier>,
    ) -> Result<PathBuf, String> {
        let mut guard = self.inner.lock().await;
        if let Some(running) = guard.as_ref() {
            return Ok(running.socket_path.clone());
        }
        tokio::fs::create_dir_all(&app_data_dir)
            .await
            .map_err(|e| format!("create app data dir: {e}"))?;
        let socket_path = app_data_dir.join(SOCKET_FILENAME);
        let meetings_dir = app_data_dir.join(MEETINGS_SUBDIR);

        // Stale socket from a prior crash leaves a path that bind()
        // refuses with EADDRINUSE; remove it before binding.
        let _ = tokio::fs::remove_file(&socket_path).await;

        let listener = UnixListener::bind(&socket_path).map_err(|e| format!("bind: {e}"))?;
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let socket_for_task = socket_path.clone();
        let ctx = Arc::new(Context {
            meetings_dir,
            notifier,
        });
        let handle = tauri::async_runtime::spawn(async move {
            run_listener(listener, ctx, cancel_rx).await;
            // Best-effort cleanup so a clean stop doesn't leave a dangling
            // socket file that ENOENTs on the next start.
            let _ = tokio::fs::remove_file(&socket_for_task).await;
        });
        *guard = Some(RunningServer {
            cancel: cancel_tx,
            handle,
            socket_path: socket_path.clone(),
        });
        Ok(socket_path)
    }

    // Stops the listener if it's running. Awaits the task so callers
    // can rely on the socket file being gone after this returns.
    pub async fn stop(&self) {
        let running = self.inner.lock().await.take();
        if let Some(running) = running {
            let _ = running.cancel.send(());
            let _ = running.handle.await;
        }
    }
}

async fn run_listener(
    listener: UnixListener,
    ctx: Arc<Context>,
    mut cancel: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut cancel => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else { continue };
                let ctx = Arc::clone(&ctx);
                tauri::async_runtime::spawn(async move {
                    handle_connection(stream, ctx).await;
                });
            }
        }
    }
}

async fn handle_connection(stream: UnixStream, ctx: Arc<Context>) {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            _ => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(req) => handle_message(req, &ctx).await,
            Err(_) => Some(error_response(Value::Null, ERR_PARSE, "Parse error")),
        };
        let Some(response) = response else { continue };
        let mut bytes = match serde_json::to_vec(&response) {
            Ok(b) => b,
            Err(_) => continue,
        };
        bytes.push(b'\n');
        if writer.write_all(&bytes).await.is_err() {
            break;
        }
        if writer.flush().await.is_err() {
            break;
        }
    }
}

// Returns None for notifications (no `id`), which JSON-RPC says must
// not be answered.
async fn handle_message(req: Value, ctx: &Context) -> Option<Value> {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(Value::as_str);
    let params = req.get("params").cloned().unwrap_or(Value::Null);

    let Some(method) = method else {
        return id.map(|id| error_response(id, ERR_INVALID_REQUEST, "Missing method"));
    };

    // Notifications: no id, no response. Includes `notifications/initialized`.
    if id.is_none() {
        return None;
    }
    let id = id.unwrap();

    match method {
        "initialize" => Some(success(id, initialize_result(&params))),
        "tools/list" => Some(success(id, tools_list_result())),
        "tools/call" => Some(handle_tools_call(id, params, ctx).await),
        "ping" => Some(success(id, json!({}))),
        _ => Some(error_response(id, ERR_METHOD_NOT_FOUND, "Method not found")),
    }
}

fn initialize_result(params: &Value) -> Value {
    let protocol = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(FALLBACK_PROTOCOL_VERSION)
        .to_string();
    json!({
        "protocolVersion": protocol,
        "capabilities": { "tools": {} },
        "serverInfo": {
            "name": "Oatpad",
            "version": env!("CARGO_PKG_VERSION"),
        }
    })
}

fn tools_list_result() -> Value {
    json!({
        "tools": [
            {
                "name": "list_meetings",
                "description": "Search and list Oatpad meeting summaries, newest first by effective time (scheduledStartAt when set, else createdAt). All filters are optional and combine with AND. Each summary has: meetingId, title (verbatim), displayName (\"meeting\" when title is blank), createdAt (ISO), optional scheduledStartAt (ISO; present when an external creator like a calendar sync or schedule_meeting planned the slot), notetaker, started (true once the meeting has any user-written note — useful for spotting upcoming-but-not-yet-started meetings), and link (an `oats://meeting/<id>` URL that opens the meeting in the desktop app). Search is title-only here, matching Oatpad's sidebar. Use this for discovery; call get_meeting to fetch the full content of a specific entry, or get_meetings_in_range when you want full content for many meetings at once.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "titleQuery": {
                            "type": "string",
                            "description": "Case-insensitive substring matched against the meeting title only. Mirrors Oatpad's sidebar search — note text is not searched here. To search inside note content, fetch a meeting with get_meeting and inspect its events log."
                        },
                        "start": {
                            "type": "string",
                            "description": "ISO 8601 datetime lower bound (e.g. \"2026-04-01\" or \"2026-04-01T00:00:00.000Z\"). Compared against effective time = scheduledStartAt ?? createdAt."
                        },
                        "end": {
                            "type": "string",
                            "description": "ISO 8601 datetime upper bound, inclusive. If end < start the values are swapped."
                        },
                        "limit": {
                            "type": "integer",
                            "minimum": 0,
                            "description": "Maximum summaries to return after sorting newest-first. Useful when you only need the most recent few."
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "get_meeting",
                "description": "Retrieve a single Oatpad meeting by id. Returns the full OatsFile JSON (events log + editor snapshot + metadata) plus a synthetic `link` field — an `oats://meeting/<id>` URL that opens the meeting in the desktop app. Note events are: `note_updated` (zero-or-more per noteId, carries the full text at a settled checkpoint — emitted when the user pauses for ~1.5s after crossing a word boundary while editing, when they leave the note, or when they substitute a complete word; rapid edit-rewrite bursts coalesce into a single event capturing the latest settled text rather than each intermediate boundary); `note_deleted` (when the paragraph is removed; only fires for paragraphs that previously emitted at least one `note_updated`, so phantom paragraphs from accidental keypresses leave no trace). Legacy meetings may also contain `note_created` (a content-less paragraph-appeared marker) — treat as informational only.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "meetingId": {
                            "type": "string",
                            "description": "The meeting UUID (the filename stem under meetings/)."
                        }
                    },
                    "required": ["meetingId"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_meetings_in_range",
                "description": "Retrieve full OatsFile JSON for every Oatpad meeting whose effective time (scheduledStartAt ?? createdAt) falls within the given ISO 8601 datetime range, inclusive on both ends. Returns full content, newest first, each entry augmented with an `oats://meeting/<id>` link that opens it in the desktop app. Prefer list_meetings for browsing — only reach for this when you genuinely need the events log or editor snapshot for many meetings at once.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "start": {
                            "type": "string",
                            "description": "Lower bound, ISO 8601 datetime (e.g. \"2026-04-01T00:00:00.000Z\")."
                        },
                        "end": {
                            "type": "string",
                            "description": "Upper bound, ISO 8601 datetime. If end < start the values are swapped."
                        },
                        "titleQuery": {
                            "type": "string",
                            "description": "Optional case-insensitive substring matched against the meeting title only. Note text is not searched."
                        },
                        "limit": {
                            "type": "integer",
                            "minimum": 0,
                            "description": "Optional cap on returned meetings (newest first)."
                        }
                    },
                    "required": ["start", "end"],
                    "additionalProperties": false
                }
            },
            {
                "name": "schedule_meeting",
                "description": "Create a new Oatpad meeting planned for a specific time. Writes a fresh `.oats` file with the given title and scheduledStartAt; Oatpad's sidebar will show it as scheduled-but-not-started. Because the server runs in-process with the app, the new meeting is visible in Oatpad immediately. Returns the new meeting's summary — including the generated meetingId and a `link` (`oats://meeting/<id>`) that opens it in the desktop app.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Human-readable name for the meeting. Required, must be non-empty after trimming."
                        },
                        "scheduledStartAt": {
                            "type": "string",
                            "description": "Planned start time as an ISO 8601 datetime (e.g. \"2026-06-15T14:00:00.000Z\"). Stored after round-tripping through chrono so loose ISO forms are normalized to UTC."
                        },
                        "notetaker": {
                            "type": "string",
                            "description": "Optional name to record on the file. Defaults to empty — the user's existing notetaker (set in Oatpad's settings) takes over once they open the meeting."
                        }
                    },
                    "required": ["title", "scheduledStartAt"],
                    "additionalProperties": false
                }
            }
        ]
    })
}

#[derive(Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Value,
}

async fn handle_tools_call(id: Value, params: Value, ctx: &Context) -> Value {
    let parsed: ToolCallParams = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(e) => return error_response(id, ERR_INVALID_PARAMS, &format!("Invalid params: {e}")),
    };
    let dir = ctx.meetings_dir.as_path();
    let (result, mutated) = match parsed.name.as_str() {
        "list_meetings" => (tool_list_meetings(parsed.arguments, dir).await, false),
        "get_meeting" => (tool_get_meeting(parsed.arguments, dir).await, false),
        "get_meetings_in_range" => {
            (tool_get_meetings_in_range(parsed.arguments, dir).await, false)
        }
        "schedule_meeting" => (tool_schedule_meeting(parsed.arguments, dir).await, true),
        other => {
            return error_response(
                id,
                ERR_METHOD_NOT_FOUND,
                &format!("Unknown tool: {other}"),
            );
        }
    };
    // Fire the change notification only when the tool was both
    // intended to mutate and actually succeeded — bad args or IO
    // failures shouldn't trigger a sidebar refresh.
    if mutated && result.is_ok() {
        if let Some(notifier) = ctx.notifier.as_ref() {
            notifier();
        }
    }
    match result {
        Ok(value) => success(id, tool_text_result(&value)),
        Err(ToolError::BadArgs(msg)) => error_response(id, ERR_INVALID_PARAMS, &msg),
        Err(ToolError::Internal(msg)) => error_response(id, ERR_INTERNAL, &msg),
        Err(ToolError::NotFound(msg)) => success(id, tool_text_error(&msg)),
    }
}

#[derive(Debug)]
enum ToolError {
    BadArgs(String),
    Internal(String),
    NotFound(String),
}

fn tool_text_result(value: &Value) -> Value {
    let text = serde_json::to_string_pretty(value).unwrap_or_default();
    json!({
        "content": [{ "type": "text", "text": text }]
    })
}

fn tool_text_error(message: &str) -> Value {
    json!({
        "isError": true,
        "content": [{ "type": "text", "text": message }]
    })
}

fn opt_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(ToolError::BadArgs(format!("`{key}` must be a string"))),
    }
}

fn opt_usize(args: &Value, key: &str) -> Result<Option<usize>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => {
            let i = n
                .as_i64()
                .ok_or_else(|| ToolError::BadArgs(format!("`{key}` must be an integer")))?;
            if i < 0 {
                return Err(ToolError::BadArgs(format!(
                    "`{key}` must be a non-negative integer"
                )));
            }
            Ok(Some(i as usize))
        }
        Some(_) => Err(ToolError::BadArgs(format!("`{key}` must be an integer"))),
    }
}

async fn tool_list_meetings(args: Value, meetings_dir: &Path) -> Result<Value, ToolError> {
    let title_query = opt_str(&args, "titleQuery")?;
    let start = opt_str(&args, "start")?;
    let end = opt_str(&args, "end")?;
    let limit = opt_usize(&args, "limit")?;
    let summaries = meetings::list_meetings(
        meetings_dir,
        MeetingFilter {
            title_query,
            start,
            end,
            limit,
        },
    )
    .await
    .map_err(filter_to_tool_error)?;
    serde_json::to_value(summaries).map_err(|e| ToolError::Internal(e.to_string()))
}

async fn tool_get_meeting(args: Value, meetings_dir: &Path) -> Result<Value, ToolError> {
    let id = opt_str(&args, "meetingId")?
        .ok_or_else(|| ToolError::BadArgs("`meetingId` must be a string".into()))?;
    let meeting = meetings::get_meeting(meetings_dir, id).await;
    let Some(meeting) = meeting else {
        return Err(ToolError::NotFound(format!(
            "No Oatpad meeting found with id {id:?}."
        )));
    };
    Ok(with_link(&meeting))
}

async fn tool_get_meetings_in_range(
    args: Value,
    meetings_dir: &Path,
) -> Result<Value, ToolError> {
    let start = opt_str(&args, "start")?
        .ok_or_else(|| ToolError::BadArgs("`start` must be an ISO 8601 string".into()))?;
    let end = opt_str(&args, "end")?
        .ok_or_else(|| ToolError::BadArgs("`end` must be an ISO 8601 string".into()))?;
    let title_query = opt_str(&args, "titleQuery")?;
    let limit = opt_usize(&args, "limit")?;
    let files = meetings::get_meetings_in_range(meetings_dir, start, end, title_query, limit)
        .await
        .map_err(filter_to_tool_error)?;
    let with_links: Vec<Value> = files.iter().map(with_link).collect();
    Ok(Value::Array(with_links))
}

async fn tool_schedule_meeting(args: Value, meetings_dir: &Path) -> Result<Value, ToolError> {
    let title = opt_str(&args, "title")?
        .ok_or_else(|| ToolError::BadArgs("`title` must be a string".into()))?;
    let scheduled_start_at = opt_str(&args, "scheduledStartAt")?
        .ok_or_else(|| ToolError::BadArgs("`scheduledStartAt` must be a string".into()))?;
    let notetaker = opt_str(&args, "notetaker")?;
    let summary = meetings::schedule_meeting(
        meetings_dir,
        ScheduleArgs {
            title,
            scheduled_start_at,
            notetaker,
        },
    )
    .await
    .map_err(schedule_to_tool_error)?;
    serde_json::to_value(summary).map_err(|e| ToolError::Internal(e.to_string()))
}

fn filter_to_tool_error(e: FilterError) -> ToolError {
    ToolError::BadArgs(e.to_string())
}

fn schedule_to_tool_error(e: ScheduleError) -> ToolError {
    match e {
        ScheduleError::EmptyTitle | ScheduleError::InvalidScheduledStartAt => {
            ToolError::BadArgs(e.to_string())
        }
        ScheduleError::Io(_) => ToolError::Internal(e.to_string()),
    }
}

// Adds a synthetic `link` field to an OatsFile response so clients can
// surface a clickable `oats://meeting/<id>` URL alongside the meeting
// content. The link is derived at response time, not stored on disk.
fn with_link(file: &OatsFile) -> Value {
    let mut value = serde_json::to_value(file).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut value {
        map.insert(
            "link".into(),
            Value::String(meetings::meeting_link(&file.meeting_id)),
        );
    }
    value
}

fn success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;
    use tokio::io::AsyncWriteExt;

    async fn round_trip(socket: &Path, request: Value) -> Value {
        let mut stream = UnixStream::connect(socket).await.unwrap();
        let mut payload = serde_json::to_vec(&request).unwrap();
        payload.push(b'\n');
        stream.write_all(&payload).await.unwrap();
        let (reader, _writer) = stream.split();
        let mut lines = BufReader::new(reader).lines();
        let line = lines.next_line().await.unwrap().unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[tokio::test]
    async fn initialize_then_tools_list() {
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let socket = state.start(tmp.path().to_path_buf(), None).await.unwrap();

        let init = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": { "protocolVersion": "2025-06-18", "capabilities": {} }
            }),
        )
        .await;
        assert_eq!(init["result"]["serverInfo"]["name"], "Oatpad");

        let tools = round_trip(
            &socket,
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        )
        .await;
        let names: Vec<&str> = tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"list_meetings"));
        assert!(names.contains(&"schedule_meeting"));

        state.stop().await;
    }

    #[tokio::test]
    async fn schedule_then_list_round_trip() {
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let socket = state.start(tmp.path().to_path_buf(), None).await.unwrap();

        let scheduled = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "schedule_meeting",
                    "arguments": {
                        "title": "Team sync",
                        "scheduledStartAt": "2026-06-15T14:00:00.000Z"
                    }
                }
            }),
        )
        .await;
        let text = scheduled["result"]["content"][0]["text"].as_str().unwrap();
        let summary: Value = serde_json::from_str(text).unwrap();
        assert_eq!(summary["title"], "Team sync");
        let meeting_id = summary["meetingId"].as_str().unwrap().to_string();

        let listed = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": { "name": "list_meetings", "arguments": {} }
            }),
        )
        .await;
        let list_text = listed["result"]["content"][0]["text"].as_str().unwrap();
        assert!(list_text.contains(&meeting_id));

        state.stop().await;
    }

    #[tokio::test]
    async fn get_meeting_missing_returns_tool_error_not_jsonrpc_error() {
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let socket = state.start(tmp.path().to_path_buf(), None).await.unwrap();

        let resp = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "get_meeting",
                    "arguments": { "meetingId": "deadbeef" }
                }
            }),
        )
        .await;
        // No JSON-RPC error — the response is a tool result with isError.
        assert!(resp.get("error").is_none());
        assert_eq!(resp["result"]["isError"], true);

        state.stop().await;
    }

    #[tokio::test]
    async fn unknown_method_returns_jsonrpc_error() {
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let socket = state.start(tmp.path().to_path_buf(), None).await.unwrap();

        let resp = round_trip(
            &socket,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "no/such/method" }),
        )
        .await;
        assert_eq!(resp["error"]["code"], ERR_METHOD_NOT_FOUND);

        state.stop().await;
    }

    #[tokio::test]
    async fn stop_removes_socket_file() {
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let socket = state.start(tmp.path().to_path_buf(), None).await.unwrap();
        assert!(socket.exists());
        state.stop().await;
        assert!(!socket.exists());
    }

    #[tokio::test]
    async fn start_after_stop_works() {
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let _ = state.start(tmp.path().to_path_buf(), None).await.unwrap();
        state.stop().await;
        let socket = state.start(tmp.path().to_path_buf(), None).await.unwrap();
        // Should be able to talk to it again.
        let resp = round_trip(
            &socket,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }),
        )
        .await;
        assert!(resp.get("result").is_some());
        state.stop().await;
    }

    #[tokio::test]
    async fn schedule_meeting_fires_notifier_exactly_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_notifier = Arc::clone(&calls);
        let notifier: Notifier = Arc::new(move || {
            calls_for_notifier.fetch_add(1, Ordering::SeqCst);
        });
        let socket = state
            .start(tmp.path().to_path_buf(), Some(notifier))
            .await
            .unwrap();

        let resp = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "schedule_meeting",
                    "arguments": {
                        "title": "Quarterly review",
                        "scheduledStartAt": "2026-06-15T14:00:00.000Z"
                    }
                }
            }),
        )
        .await;
        assert!(resp["result"]["isError"].as_bool() != Some(true));
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        state.stop().await;
    }

    #[tokio::test]
    async fn read_only_tools_do_not_fire_notifier() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_notifier = Arc::clone(&calls);
        let notifier: Notifier = Arc::new(move || {
            calls_for_notifier.fetch_add(1, Ordering::SeqCst);
        });
        let socket = state
            .start(tmp.path().to_path_buf(), Some(notifier))
            .await
            .unwrap();

        let _ = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": { "name": "list_meetings", "arguments": {} }
            }),
        )
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        state.stop().await;
    }

    #[tokio::test]
    async fn failing_schedule_does_not_fire_notifier() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let tmp = TempDir::new().unwrap();
        let state = State::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_notifier = Arc::clone(&calls);
        let notifier: Notifier = Arc::new(move || {
            calls_for_notifier.fetch_add(1, Ordering::SeqCst);
        });
        let socket = state
            .start(tmp.path().to_path_buf(), Some(notifier))
            .await
            .unwrap();

        // Empty title — schedule_meeting rejects, must not notify.
        let _ = round_trip(
            &socket,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "schedule_meeting",
                    "arguments": {
                        "title": "  ",
                        "scheduledStartAt": "2026-06-15T14:00:00.000Z"
                    }
                }
            }),
        )
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        state.stop().await;
    }
}
