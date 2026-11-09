use super::resolved_renames;
use crate::services::source_watch::SourceChangeBatch;
use std::path::PathBuf;

#[test]
fn final_source_rename_destinations_cover_chains_and_nested_files() {
    let batch = SourceChangeBatch {
        renames: vec![
            (
                PathBuf::from("M:/sample/first"),
                PathBuf::from("M:/sample/second"),
            ),
            (
                PathBuf::from("M:/sample/second/Entry.java"),
                PathBuf::from("M:/sample/second/Final.java"),
            ),
            (
                PathBuf::from("M:/sample/second"),
                PathBuf::from("M:/sample/third"),
            ),
        ],
        ..Default::default()
    };
    let results = resolved_renames(
        &batch,
        &[
            "M:/sample/first/Entry.java".into(),
            "M:/sample/first/Other.java".into(),
        ],
    );
    let result = |path: &str| {
        results
            .iter()
            .find(|(before, _)| before == path)
            .unwrap()
            .1
            .replace('\\', "/")
    };
    assert_eq!(
        result("M:/sample/first/Entry.java"),
        "M:/sample/third/Final.java"
    );
    assert_eq!(
        result("M:/sample/first/Other.java"),
        "M:/sample/third/Other.java"
    );
    assert_eq!(
        result("M:/sample/first").trim_end_matches('/'),
        "M:/sample/third"
    );
}
