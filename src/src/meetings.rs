// In-app meeting helpers — port of the previous mcp/src/meetings.ts.
//
// The MCP server and the running app now share the same code path: this
// module reads/writes `.oats` files in the meetings directory and the
// `mcp_server` module dispatches MCP tool calls into it. Keeping it
// here (rather than in the .mcpb proxy) means writes from MCP clients
// land on disk through the same code that owns the directory.
//
// Events and editor snapshots stay opaque (`serde_json::Value`) — only
// the envelope is parsed. That mirrors the original TS validator and
// keeps round-trips lossless when the file version doesn't yet know
// about a newer event field.

use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::fs;

const OATS_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Snapshot {
    pub ops: Vec<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OatsFile {
    pub version: u32,
    #[serde(rename = "meetingId")]
    pub meeting_id: String,
    pub notetaker: String,
    pub title: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "scheduledStartAt", skip_serializing_if = "Option::is_none")]
    pub scheduled_start_at: Option<String>,
    pub events: Vec<Value>,
    pub snapshot: Snapshot,
    #[serde(rename = "paragraphIds")]
    pub paragraph_ids: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct MeetingSummary {
    #[serde(rename = "meetingId")]
    pub meeting_id: String,
    pub title: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "scheduledStartAt", skip_serializing_if = "Option::is_none")]
    pub scheduled_start_at: Option<String>,
    pub notetaker: String,
    pub started: bool,
    pub link: String,
}

// Custom URL scheme registered by the desktop app (see
// `src/tauri.conf.json` `plugins.deep-link.desktop.schemes`). The TS
// helper in `src-web/lib/deepLink.ts` builds the same shape — both must
// agree on the form.
pub fn meeting_link(meeting_id: &str) -> String {
    format!("oats://meeting/{meeting_id}")
}

pub fn effective_time(file: &OatsFile) -> &str {
    file.scheduled_start_at.as_deref().unwrap_or(&file.created_at)
}

fn is_started(events: &[Value]) -> bool {
    events.iter().any(|e| {
        e.get("type").and_then(Value::as_str).map_or(false, |s| {
            s == "note_updated" || s == "note_deleted"
        })
    })
}

pub fn summary_of(file: &OatsFile) -> MeetingSummary {
    let trimmed = file.title.trim();
    let display_name = if trimmed.is_empty() { "meeting" } else { trimmed };
    MeetingSummary {
        meeting_id: file.meeting_id.clone(),
        title: file.title.clone(),
        display_name: display_name.to_string(),
        created_at: file.created_at.clone(),
        scheduled_start_at: file.scheduled_start_at.clone(),
        notetaker: file.notetaker.clone(),
        started: is_started(&file.events),
        link: meeting_link(&file.meeting_id),
    }
}

pub fn parse_oats_file(text: &str) -> Option<OatsFile> {
    let file: OatsFile = serde_json::from_str(text).ok()?;
    if file.version != OATS_VERSION {
        return None;
    }
    Some(file)
}

async fn read_meeting_file(dir: &Path, name: &str) -> Option<OatsFile> {
    let text = fs::read_to_string(dir.join(name)).await.ok()?;
    parse_oats_file(&text)
}

async fn read_all_oats_files(dir: &Path) -> Vec<OatsFile> {
    let Ok(mut entries) = fs::read_dir(dir).await else {
        return Vec::new();
    };
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.ends_with(".oats") {
            continue;
        }
        // Skip subdirectories named `*.oats` rather than crashing the loop.
        if entry.file_type().await.map_or(true, |t| !t.is_file()) {
            continue;
        }
        if let Some(file) = read_meeting_file(dir, name).await {
            files.push(file);
        }
    }
    files
}

#[derive(Debug, Default)]
pub struct MeetingFilter<'a> {
    pub title_query: Option<&'a str>,
    pub start: Option<&'a str>,
    pub end: Option<&'a str>,
    pub limit: Option<usize>,
}

#[derive(Debug)]
pub enum FilterError {
    InvalidStart,
    InvalidEnd,
}

impl std::fmt::Display for FilterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidStart => write!(f, "`start` must be an ISO 8601 datetime"),
            Self::InvalidEnd => write!(f, "`end` must be an ISO 8601 datetime"),
        }
    }
}

impl std::error::Error for FilterError {}

// Accepts the same shapes JS's `Date.parse` accepts in practice for our
// callers: full RFC3339 (`2026-04-02T08:00:00.000Z`) and date-only
// (`2026-04-02`). Date-only is interpreted as midnight UTC, matching JS.
fn parse_iso_to_millis(s: &str) -> Option<i64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(dt.and_utc().timestamp_millis());
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt.and_utc().timestamp_millis());
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        let ndt = NaiveDateTime::new(d, NaiveTime::from_hms_opt(0, 0, 0)?);
        return Some(ndt.and_utc().timestamp_millis());
    }
    None
}

fn parse_range(filter: &MeetingFilter<'_>) -> Result<(Option<i64>, Option<i64>), FilterError> {
    let lo = match filter.start {
        Some(s) => Some(parse_iso_to_millis(s).ok_or(FilterError::InvalidStart)?),
        None => None,
    };
    let hi = match filter.end {
        Some(s) => Some(parse_iso_to_millis(s).ok_or(FilterError::InvalidEnd)?),
        None => None,
    };
    Ok(match (lo, hi) {
        (Some(a), Some(b)) if a > b => (Some(b), Some(a)),
        other => other,
    })
}

fn matches_title(file: &OatsFile, query: Option<&str>) -> bool {
    let Some(q) = query else { return true };
    if q.is_empty() {
        return true;
    }
    file.title.to_lowercase().contains(&q.to_lowercase())
}

fn matches_range(file: &OatsFile, lo: Option<i64>, hi: Option<i64>) -> bool {
    if lo.is_none() && hi.is_none() {
        return true;
    }
    let Some(ts) = parse_iso_to_millis(effective_time(file)) else {
        return false;
    };
    if let Some(lo) = lo {
        if ts < lo {
            return false;
        }
    }
    if let Some(hi) = hi {
        if ts > hi {
            return false;
        }
    }
    true
}

fn apply_filter(
    mut files: Vec<OatsFile>,
    filter: &MeetingFilter<'_>,
) -> Result<Vec<OatsFile>, FilterError> {
    let (lo, hi) = parse_range(filter)?;
    files.retain(|f| matches_range(f, lo, hi) && matches_title(f, filter.title_query));
    // Newest-first by effective time. ISO strings sort temporally as
    // long as everyone uses the same timezone; we do (UTC).
    files.sort_by(|a, b| effective_time(b).cmp(effective_time(a)));
    if let Some(limit) = filter.limit {
        files.truncate(limit);
    }
    Ok(files)
}

pub async fn list_meetings(
    dir: &Path,
    filter: MeetingFilter<'_>,
) -> Result<Vec<MeetingSummary>, FilterError> {
    let files = read_all_oats_files(dir).await;
    let filtered = apply_filter(files, &filter)?;
    Ok(filtered.iter().map(summary_of).collect())
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub async fn get_meeting(dir: &Path, meeting_id: &str) -> Option<OatsFile> {
    if !is_safe_id(meeting_id) {
        return None;
    }
    read_meeting_file(dir, &format!("{meeting_id}.oats")).await
}

pub async fn get_meetings_in_range(
    dir: &Path,
    start: &str,
    end: &str,
    title_query: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<OatsFile>, FilterError> {
    let files = read_all_oats_files(dir).await;
    apply_filter(
        files,
        &MeetingFilter {
            title_query,
            start: Some(start),
            end: Some(end),
            limit,
        },
    )
}

#[derive(Debug)]
pub enum ScheduleError {
    EmptyTitle,
    InvalidScheduledStartAt,
    Io(std::io::Error),
}

impl std::fmt::Display for ScheduleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyTitle => write!(f, "`title` must not be empty"),
            Self::InvalidScheduledStartAt => {
                write!(f, "`scheduledStartAt` must be an ISO 8601 datetime")
            }
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ScheduleError {}

pub struct ScheduleArgs<'a> {
    pub title: &'a str,
    pub scheduled_start_at: &'a str,
    pub notetaker: Option<&'a str>,
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_normalize(input: &str) -> Option<String> {
    let ms = parse_iso_to_millis(input)?;
    let dt = DateTime::<Utc>::from_timestamp_millis(ms)?;
    Some(dt.to_rfc3339_opts(SecondsFormat::Millis, true))
}

// Mirrors the app's `blankMeeting`: a single `meeting_started` event
// at createdAt, an empty editor snapshot, no paragraph IDs. The app
// renders it as scheduled-but-not-started until the user opens it and
// types.
pub async fn schedule_meeting(
    dir: &Path,
    args: ScheduleArgs<'_>,
) -> Result<MeetingSummary, ScheduleError> {
    let title = args.title.trim();
    if title.is_empty() {
        return Err(ScheduleError::EmptyTitle);
    }
    let scheduled_start_at =
        iso_normalize(args.scheduled_start_at).ok_or(ScheduleError::InvalidScheduledStartAt)?;
    let notetaker = args.notetaker.unwrap_or("").trim().to_string();
    let meeting_id = uuid::Uuid::new_v4().to_string();
    let created_at = iso_now();

    let mut started_event = Map::new();
    started_event.insert("type".into(), Value::String("meeting_started".into()));
    started_event.insert(
        "id".into(),
        Value::String(uuid::Uuid::new_v4().to_string()),
    );
    started_event.insert("ts".into(), Value::String(created_at.clone()));
    started_event.insert("notetaker".into(), Value::String(notetaker.clone()));

    let file = OatsFile {
        version: OATS_VERSION,
        meeting_id: meeting_id.clone(),
        notetaker,
        title: title.to_string(),
        created_at,
        scheduled_start_at: Some(scheduled_start_at),
        events: vec![Value::Object(started_event)],
        snapshot: Snapshot {
            ops: vec![Value::Object({
                let mut m = Map::new();
                m.insert("insert".into(), Value::String("\n".into()));
                m
            })],
            extra: Map::new(),
        },
        paragraph_ids: Vec::new(),
    };

    fs::create_dir_all(dir).await.map_err(ScheduleError::Io)?;
    let path: PathBuf = dir.join(format!("{meeting_id}.oats"));
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| ScheduleError::Io(std::io::Error::other(e)))?;
    fs::write(&path, json).await.map_err(ScheduleError::Io)?;
    Ok(summary_of(&file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn make_file(id: &str, title: &str, created_at: &str) -> OatsFile {
        OatsFile {
            version: 1,
            meeting_id: id.into(),
            notetaker: "Tom".into(),
            title: title.into(),
            created_at: created_at.into(),
            scheduled_start_at: None,
            events: vec![json!({
                "type": "meeting_started",
                "id": format!("{id}-s"),
                "ts": created_at,
                "notetaker": "Tom",
            })],
            snapshot: Snapshot {
                ops: vec![json!({"insert": "\n"})],
                extra: Map::new(),
            },
            paragraph_ids: Vec::new(),
        }
    }

    async fn write_file(dir: &Path, file: &OatsFile) {
        let path = dir.join(format!("{}.oats", file.meeting_id));
        fs::write(&path, serde_json::to_string_pretty(file).unwrap())
            .await
            .unwrap();
    }

    #[test]
    fn meeting_link_format() {
        assert_eq!(meeting_link("abc-123"), "oats://meeting/abc-123");
    }

    #[test]
    fn summary_uses_trimmed_title_for_display_name() {
        let m = summary_of(&make_file("a", "  Standup  ", "2026-04-27T10:00:00Z"));
        assert_eq!(m.display_name, "Standup");
        // Original title is preserved verbatim.
        assert_eq!(m.title, "  Standup  ");
    }

    #[test]
    fn summary_falls_back_to_meeting_for_blank_title() {
        let m = summary_of(&make_file("a", "", "2026-04-27T10:00:00Z"));
        assert_eq!(m.display_name, "meeting");
        let m = summary_of(&make_file("a", "   ", "2026-04-27T10:00:00Z"));
        assert_eq!(m.display_name, "meeting");
    }

    #[test]
    fn summary_includes_link() {
        let m = summary_of(&make_file("abc-123", "M", "2026-04-27T10:00:00Z"));
        assert_eq!(m.link, "oats://meeting/abc-123");
    }

    #[test]
    fn summary_started_flips_on_note_event() {
        let mut f = make_file("a", "M", "2026-04-27T10:00:00Z");
        assert!(!summary_of(&f).started);
        f.events.push(json!({
            "type": "note_updated",
            "id": "x",
            "ts": "2026-04-27T10:00:01Z",
            "noteId": "p1",
            "text": "hello",
        }));
        assert!(summary_of(&f).started);
    }

    #[test]
    fn effective_time_prefers_scheduled() {
        let mut f = make_file("a", "M", "2026-04-27T10:00:00Z");
        assert_eq!(effective_time(&f), "2026-04-27T10:00:00Z");
        f.scheduled_start_at = Some("2026-05-01T09:00:00.000Z".into());
        assert_eq!(effective_time(&f), "2026-05-01T09:00:00.000Z");
    }

    #[tokio::test]
    async fn list_returns_empty_for_missing_dir() {
        let tmp = TempDir::new().unwrap();
        let out = list_meetings(&tmp.path().join("nope"), MeetingFilter::default())
            .await
            .unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn list_orders_newest_first_by_effective_time() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("aaa", "First", "2026-04-27T09:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("bbb", "Second", "2026-04-27T11:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("ccc", "Third", "2026-04-27T10:00:00.000Z")).await;
        let out = list_meetings(tmp.path(), MeetingFilter::default())
            .await
            .unwrap();
        let ids: Vec<&str> = out.iter().map(|m| m.meeting_id.as_str()).collect();
        assert_eq!(ids, vec!["bbb", "ccc", "aaa"]);
    }

    #[tokio::test]
    async fn list_uses_scheduled_start_when_present() {
        let tmp = TempDir::new().unwrap();
        let mut sched = make_file("sched", "Future", "2026-04-27T11:00:00Z");
        sched.scheduled_start_at = Some("2026-05-01T09:00:00.000Z".into());
        write_file(tmp.path(), &sched).await;
        write_file(tmp.path(), &make_file("now", "Now", "2026-04-27T10:00:00Z")).await;
        let out = list_meetings(tmp.path(), MeetingFilter::default())
            .await
            .unwrap();
        let ids: Vec<&str> = out.iter().map(|m| m.meeting_id.as_str()).collect();
        assert_eq!(ids, vec!["sched", "now"]);
    }

    #[tokio::test]
    async fn list_skips_non_oats_and_malformed() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("good", "OK", "2026-04-27T10:00:00Z")).await;
        fs::write(tmp.path().join("README.md"), "# stray").await.unwrap();
        fs::write(tmp.path().join("bad.oats"), "{ not json").await.unwrap();
        fs::write(tmp.path().join("wrong.oats"), r#"{"version": 99}"#).await.unwrap();
        let out = list_meetings(tmp.path(), MeetingFilter::default())
            .await
            .unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].meeting_id, "good");
    }

    #[tokio::test]
    async fn list_filters_by_title_case_insensitively() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("a", "Weekly Standup", "2026-04-01T10:00:00Z")).await;
        write_file(tmp.path(), &make_file("b", "Roadmap review", "2026-04-02T10:00:00Z")).await;
        let out = list_meetings(
            tmp.path(),
            MeetingFilter {
                title_query: Some("STANDUP"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let ids: Vec<&str> = out.iter().map(|m| m.meeting_id.as_str()).collect();
        assert_eq!(ids, vec!["a"]);
    }

    #[tokio::test]
    async fn list_filters_by_range_inclusive_on_both_ends() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("a", "A", "2026-04-01T08:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("b", "B", "2026-04-02T08:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("c", "C", "2026-04-02T20:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("d", "D", "2026-04-03T08:00:00.000Z")).await;

        let out = list_meetings(
            tmp.path(),
            MeetingFilter {
                start: Some("2026-04-02T00:00:00.000Z"),
                end: Some("2026-04-02T23:59:59.999Z"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let mut ids: Vec<&str> = out.iter().map(|m| m.meeting_id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["b", "c"]);
    }

    #[tokio::test]
    async fn list_range_compares_in_milliseconds_not_lexicographic() {
        // Pinning ms-compare semantics — a date-only bound parses as
        // midnight UTC. We only assert that meetings on other days are
        // excluded; same-day meetings at non-midnight may or may not
        // fall inside [midnight, midnight]. The JS port asserted the
        // same exclusion.
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("a", "A", "2026-04-01T08:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("b", "B", "2026-04-02T08:00:00.000Z")).await;
        write_file(tmp.path(), &make_file("c", "C", "2026-04-02T20:00:00.000Z")).await;

        let out = get_meetings_in_range(tmp.path(), "2026-04-02", "2026-04-02", None, None)
            .await
            .unwrap();
        let ids: Vec<&str> = out.iter().map(|f| f.meeting_id.as_str()).collect();
        assert!(!ids.contains(&"a"));
    }

    #[tokio::test]
    async fn list_throws_on_unparseable_iso_bounds() {
        let tmp = TempDir::new().unwrap();
        let err = list_meetings(
            tmp.path(),
            MeetingFilter {
                start: Some("not-a-date"),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, FilterError::InvalidStart));
    }

    #[tokio::test]
    async fn list_respects_limit_after_sort() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("a", "A", "2026-04-01T10:00:00Z")).await;
        write_file(tmp.path(), &make_file("b", "B", "2026-04-02T10:00:00Z")).await;
        write_file(tmp.path(), &make_file("c", "C", "2026-04-03T10:00:00Z")).await;
        let out = list_meetings(
            tmp.path(),
            MeetingFilter {
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let ids: Vec<&str> = out.iter().map(|m| m.meeting_id.as_str()).collect();
        assert_eq!(ids, vec!["c", "b"]);
    }

    #[tokio::test]
    async fn get_meeting_returns_none_for_invalid_id() {
        let tmp = TempDir::new().unwrap();
        write_file(tmp.path(), &make_file("abc-123", "Real", "2026-04-27T10:00:00Z")).await;
        assert!(get_meeting(tmp.path(), "abc-123").await.is_some());
        assert!(get_meeting(tmp.path(), "../etc/passwd").await.is_none());
        assert!(get_meeting(tmp.path(), "abc/../abc-123").await.is_none());
        // Dot is not allowed (would otherwise let `abc.123` collide with extension).
        assert!(get_meeting(tmp.path(), "abc.123").await.is_none());
        assert!(get_meeting(tmp.path(), " abc-123").await.is_none());
        assert!(get_meeting(tmp.path(), "").await.is_none());
    }

    #[tokio::test]
    async fn schedule_writes_well_formed_file() {
        let tmp = TempDir::new().unwrap();
        let summary = schedule_meeting(
            tmp.path(),
            ScheduleArgs {
                title: "  Quarterly review  ",
                scheduled_start_at: "2026-06-15T14:00:00.000Z",
                notetaker: Some("Tom"),
            },
        )
        .await
        .unwrap();
        assert_eq!(summary.title, "Quarterly review");
        assert_eq!(summary.scheduled_start_at.as_deref(), Some("2026-06-15T14:00:00.000Z"));
        assert!(!summary.started);
        assert_eq!(summary.link, format!("oats://meeting/{}", summary.meeting_id));

        let on_disk = get_meeting(tmp.path(), &summary.meeting_id).await.unwrap();
        assert_eq!(on_disk.title, "Quarterly review");
        assert_eq!(on_disk.notetaker, "Tom");
        assert_eq!(on_disk.events[0]["type"], "meeting_started");
    }

    #[tokio::test]
    async fn schedule_rejects_empty_title() {
        let tmp = TempDir::new().unwrap();
        let err = schedule_meeting(
            tmp.path(),
            ScheduleArgs {
                title: "   ",
                scheduled_start_at: "2026-06-15T14:00:00.000Z",
                notetaker: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ScheduleError::EmptyTitle));
    }

    #[tokio::test]
    async fn schedule_rejects_unparseable_datetime() {
        let tmp = TempDir::new().unwrap();
        let err = schedule_meeting(
            tmp.path(),
            ScheduleArgs {
                title: "Whatever",
                scheduled_start_at: "next tuesday",
                notetaker: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ScheduleError::InvalidScheduledStartAt));
    }

    #[tokio::test]
    async fn schedule_normalizes_loose_iso_to_full_utc_millis() {
        let tmp = TempDir::new().unwrap();
        let summary = schedule_meeting(
            tmp.path(),
            ScheduleArgs {
                title: "Sync",
                scheduled_start_at: "2026-06-15T14:00:00Z",
                notetaker: None,
            },
        )
        .await
        .unwrap();
        let s = summary.scheduled_start_at.unwrap();
        // Always full-precision UTC after round-tripping through chrono.
        assert!(
            s.ends_with("Z") && s.contains(".") && s.len() == "2026-06-15T14:00:00.000Z".len(),
            "unexpected normalized form: {s}"
        );
    }

    #[tokio::test]
    async fn schedule_creates_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("nested");
        let _ = schedule_meeting(
            &dir,
            ScheduleArgs {
                title: "Fresh",
                scheduled_start_at: "2026-06-15T14:00:00Z",
                notetaker: None,
            },
        )
        .await
        .unwrap();
        assert!(dir.is_dir());
    }
}
