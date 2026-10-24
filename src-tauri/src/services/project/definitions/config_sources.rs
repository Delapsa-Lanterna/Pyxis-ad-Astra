pub(in crate::services::project) const CONFIG_OPTION_SOURCES: &[(&str, &str, Option<&str>)] = &[
    ("config:sounds", "data/config/sounds.json", None),
    (
        "config:designTypes",
        "data/config/settings.json",
        Some("designTypeColors"),
    ),
    ("config:hullStyles", "data/config/hull_styles.json", None),
    (
        "config:engineStyles",
        "data/config/engine_styles.json",
        None,
    ),
];
