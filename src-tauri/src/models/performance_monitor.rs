use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSample {
    pub name: String,
    pub category: String,
    pub started_at: f64,
    pub duration: f64,
    pub fields: BTreeMap<String, serde_json::Value>,
}
#[derive(Deserialize)]
pub struct PerformanceBatch {
    pub samples: Vec<PerformanceSample>,
    pub overwritten: u64,
    pub environment: serde_json::Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMonitorStatus {
    pub enabled: bool,
    pub records: usize,
    pub overwritten: u64,
    pub started_at: f64,
    pub path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerformanceMonitorAction {
    Status,
    Reset,
    Export,
}
