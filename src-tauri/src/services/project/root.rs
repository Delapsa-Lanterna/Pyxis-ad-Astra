#[cfg(test)]
mod tests {
    use crate::domain::entity_definitions;
    use crate::io::write_utf8_no_bom;
    use crate::models::EntityKind;
    use crate::services::project::sources::SourceReader;
    use crate::services::project::test_support::project_workspace;
    use std::fs;

    #[test]
    fn mission_count_ignores_comment_rows() {
        let root = project_workspace("mission_count_comments");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\n#comment,Hidden\r\n\"#archived\",Archived\r\ndemo,Demo\r\n",
        )
        .unwrap();

        let mut sources = SourceReader::new(&root).unwrap();
        let count = sources
            .count(
                &sources.path("data/missions/mission_list.csv").unwrap(),
                "mission",
                |id| entity_definitions::csv_id_active(EntityKind::Mission, id),
            )
            .unwrap();

        assert_eq!(count, 1);
        root.close().unwrap();
    }
}
