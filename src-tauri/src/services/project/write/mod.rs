pub(in crate::services) mod csv_patch;
pub(in crate::services) mod entity_write;
pub(in crate::services) mod faction_identity;

pub(in crate::services) mod joint_edit;

pub(in crate::services) mod json_recovery;

#[cfg(test)]
mod json_recovery_tests;

#[cfg(test)]
mod csv_first_save_tests;
