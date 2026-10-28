use super::*;
#[cfg(test)]
use crate::testutil::TestWorkspace;

fn sample(duration: f64) -> PerformanceSample {
    PerformanceSample {
        name: "sample".into(),
        category: "ipc".into(),
        started_at: 10.0,
        duration,
        fields: BTreeMap::new(),
    }
}

#[test]
fn ring_capacity_and_restart_boundary() {
    let mut monitor = Monitor {
        started_at: 10.0,
        ..Monitor::default()
    };
    let mut stale = sample(1.0);
    stale.started_at = 9.0;
    monitor.push("main".into(), stale);
    assert!(monitor.records.is_empty());
    for index in 0..50_002 {
        monitor.push("main".into(), sample(index as f64));
    }
    assert_eq!(monitor.records.len(), 50_000);
    assert_eq!(monitor.overwritten, 2);
    assert_eq!(monitor.records.front().unwrap().1.duration, 2.0);
}

#[test]
#[ignore = "explicit monitor report artifact"]
fn monitor_report_example() {
    let mut monitor = Monitor::default();
    monitor.windows.insert("main".into(), json!({"environment":{"version":env!("CARGO_PKG_VERSION"),"width":1280,"height":720,"dpr":1.5,"supported":["event","longtask"]},"deliveredAt":10.0}));
    for (category, name, duration) in [
        ("ipc", "fixture.query", 1.125),
        ("backend", "fixture.query", 0.5),
        ("query", "fixture.query", 2.0),
        ("action", "fixture.edit", 0.125),
    ] {
        let mut row = sample(duration);
        row.name = name.into();
        row.category = category.into();
        row.fields.insert("request".into(), json!("main:1"));
        monitor.push("main".into(), row);
    }
    let directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/performance-monitor");
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("report-example.json");
    write_utf8_no_bom(
        &path,
        &serde_json::to_string_pretty(&monitor.export()).unwrap(),
    )
    .unwrap();
    println!("{}", path.display());
}

#[test]
fn export_stats_and_payload_filter() {
    let mut monitor = Monitor::default();
    for duration in [1.125, 4.0, 2.0, 3.0] {
        let mut row = sample(duration);
        row.fields = BTreeMap::from([
            ("request".into(), json!("request-1")),
            ("payload".into(), json!({"secret":"private"})),
            ("modRoot".into(), json!("M:/private")),
            ("rows".into(), json!(40)),
        ]);
        monitor.push("main".into(), row);
    }
    let mut other = sample(12.0);
    other.category = "backend".into();
    monitor.push("child".into(), other);
    let value = monitor.export();
    let summary = value["statistics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["category"] == "ipc")
        .unwrap();
    assert_eq!(
        summary,
        &json!({"category":"ipc","name":"sample","n":4,"min":1.125,"max":4.0,"mean":2.53125,"median":2.5,"p95":4.0})
    );
    let events: Vec<_> = value["traceEvents"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|event| event["ph"] == "X")
        .collect();
    assert_eq!(events.len(), 5);
    assert_eq!(events[0]["dur"], 1125.0);
    assert_eq!(events[0]["ts"], 10000.0);
    assert_ne!(events[0]["tid"], events[4]["tid"]);
    assert_eq!(events[0]["args"], json!({"request":"request-1","rows":40}));
    let directory = TestWorkspace::new("monitor_export");
    let path = directory.join("trace.json");
    write_utf8_no_bom(&path, &serde_json::to_string(&value).unwrap()).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes.starts_with(&[0xef, 0xbb, 0xbf]));
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), value);
    directory.close().unwrap();
}
