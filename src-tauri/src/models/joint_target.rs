use crate::models::project_identity;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum JointEditKind {
    Ship,
    Skin,
    Weapon,
    Wing,
    Variant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JointEditRoot {
    pub session_id: String,
    pub mod_root: String,
    pub kind: JointEditKind,
    pub id: String,
}

project_identity::impl_session_mod_scope_required!(JointEditRoot);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SessionModScope;
    use serde_json::json;

    #[test]
    fn joint_roots_keep_wire_identity_and_session_scope() {
        for kind in ["ship", "skin", "weapon", "wing", "variant"] {
            let value =
                json!({"sessionId":"session","modRoot":"M:/fixture","kind":kind,"id":"item"});
            let root: JointEditRoot = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(root.session_id(), Some(&root.session_id));
            assert_eq!(root.mod_root(), "M:/fixture");
            assert_eq!(serde_json::to_value(root).unwrap(), value);
        }
    }
}
