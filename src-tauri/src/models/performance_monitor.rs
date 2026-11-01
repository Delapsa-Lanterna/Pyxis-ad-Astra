use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSample {
    pub name: String,
    pub category: String,
    pub started_at: f64,
    pub duration: f64,
    pub fields: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
pub struct PerformanceBatch {
    pub samples: Vec<PerformanceSample>,
    pub overwritten: u64,
    pub environment: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMonitorStatus {
    pub enabled: bool,
    pub records: usize,
    pub overwritten: u64,
    pub started_at: f64,
    pub path: String,
    pub trace_available: bool,
    pub trace_state: String,
    pub trace_seconds: u8,
    pub trace_started_at: f64,
    pub trace_error: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceMonitorAction {
    Status,
    Reset,
    Export,
    TraceStart,
    TraceStop,
}

#[cfg(windows)]
pub(crate) fn collect_webview_frames(tree: &Value, frames: &mut BTreeSet<String>) {
    if let Some(id) = tree["frame"]["id"].as_str() {
        frames.insert(id.into());
    }
    if let Some(children) = tree["childFrames"].as_array() {
        for child in children {
            collect_webview_frames(child, frames);
        }
    }
}

#[cfg(windows)]
pub(crate) fn is_main_webview_event(event: &Value, frames: &BTreeSet<String>) -> bool {
    event["args"]["beginData"]["frame"]
        .as_str()
        .or_else(|| event["args"]["data"]["frame"].as_str())
        .or_else(|| event["args"]["data"]["page"].as_str())
        .or_else(|| event["args"]["frame"].as_str())
        .or_else(|| event["args"]["page"].as_str())
        .is_some_and(|frame| frames.contains(frame))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn main_frame_ids_filter_trace_events() {
        let tree = json!({"frame":{"id":"main"},"childFrames":[{"frame":{"id":"main-child"}}]});
        let mut frames = BTreeSet::new();
        collect_webview_frames(&tree, &mut frames);
        let event = |name, frame| json!({"name":name,"args":{"beginData":{"frame":frame}}});
        assert!(is_main_webview_event(&event("Layout", "main"), &frames));
        assert!(is_main_webview_event(
            &event("Paint", "main-child"),
            &frames
        ));
        assert!(is_main_webview_event(
            &event("FunctionCall", "main"),
            &frames
        ));
        assert!(is_main_webview_event(
            &json!({"name":"ResourceSendRequest","args":{"data":{"page":"main"}}}),
            &frames
        ));
        assert!(!is_main_webview_event(
            &event("Layout", "other-window"),
            &frames
        ));
        assert!(!is_main_webview_event(
            &json!({"name":"Layout","args":{}}),
            &frames
        ));
    }
}
