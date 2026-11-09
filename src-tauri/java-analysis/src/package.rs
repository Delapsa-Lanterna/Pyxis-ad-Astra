use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub version: String,
    pub protocol: u32,
    pub java: u32,
    pub bytes: u64,
    pub sha256: String,
    pub artifacts: Vec<Artifact>,
    pub bundles: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Artifact {
    pub path: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub protocol: u32,
    pub java: u32,
    pub bundles: Vec<String>,
    pub files: Vec<PackageFile>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    pub version: String,
    pub protocol: u32,
    pub java: u32,
    pub launcher: String,
    pub bundle: String,
    pub framework: String,
    pub dependencies: Manifest,
    pub files: Vec<PackageFile>,
}

impl Package {
    pub(crate) fn manifest(&self) -> Manifest {
        Manifest {
            version: self.version.clone(),
            protocol: self.protocol,
            java: self.java,
            bundles: self.bundles.clone(),
            files: self
                .artifacts
                .iter()
                .map(|file| PackageFile {
                    path: file.path.clone(),
                    bytes: file.bytes,
                    sha256: file.sha256.clone(),
                })
                .collect(),
        }
    }
}
