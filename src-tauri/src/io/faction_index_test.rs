#![cfg(test)]
use crate::io::{read_faction_index, write_utf8_no_bom};
use crate::test_support::TestWorkspace;
use std::fs;

#[test]
fn faction_index_rejects_parent_escape_before_loading_business_content() {
    let root = TestWorkspace::new("faction_index_escape");
    fs::create_dir_all(root.join("data/world/factions")).unwrap();
    write_utf8_no_bom(
        &root.join("data/world/factions/factions.csv"),
        "id,file\noutside,../outside.faction\n",
    )
    .unwrap();
    let error = read_faction_index(&root).unwrap_err();
    assert_eq!(error.code(), "path.invalid_relative");
    root.close().unwrap();
}

#[test]
fn faction_index_rejects_link_parent_at_the_authorized_root_boundary() {
    let (root, _outside, _) =
        TestWorkspace::directory_link("faction_index_link", "data/custom").unwrap();
    fs::create_dir_all(root.join("data/world/factions")).unwrap();
    write_utf8_no_bom(
        &root.join("data/world/factions/factions.csv"),
        "id,file\noutside,data/custom/outside.faction\n",
    )
    .unwrap();
    let error = read_faction_index(&root).unwrap_err();
    assert_eq!(error.code(), "path.link_rejected");
    println!("Faction linked parent rejected by the production root boundary");
    root.close().unwrap();
}

#[cfg(windows)]
#[test]
fn faction_index_rejects_junction_parent_at_the_authorized_root_boundary() {
    let (root, outside, link) = TestWorkspace::junction("faction_index_junction", "data/custom");
    fs::create_dir_all(root.join("data/world/factions")).unwrap();
    write_utf8_no_bom(
        &root.join("data/world/factions/factions.csv"),
        "faction\ndata/custom/outside.faction\n",
    )
    .unwrap();
    write_utf8_no_bom(&outside.join("outside.faction"), "{id:'outside'}").unwrap();
    let error = read_faction_index(&root).unwrap_err();
    assert_eq!(error.code(), "path.link_rejected");
    assert!(outside.join("outside.faction").is_file());
    fs::remove_dir(link).unwrap();
    root.close().unwrap();
}
