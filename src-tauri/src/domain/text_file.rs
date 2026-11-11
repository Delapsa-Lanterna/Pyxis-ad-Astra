pub(crate) fn binary(bytes: &[u8]) -> bool {
    const SIGNATURES: &[&[u8]] = &[
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"GIF87a",
        b"GIF89a",
        b"BM",
        b"DDS ",
        b"RIFF",
        b"OggS",
        b"fLaC",
        b"ID3",
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"PK\x07\x08",
        b"\x1f\x8b",
        b"7z\xbc\xaf\x27\x1c",
        b"Rar!\x1a\x07",
        b"MZ",
        b"\xca\xfe\xba\xbe",
    ];
    SIGNATURES
        .iter()
        .any(|signature| bytes.starts_with(signature))
        || bytes.starts_with(&[0xff]) && bytes.get(1).is_some_and(|byte| byte & 0xe0 == 0xe0)
        || bytes.iter().any(|byte| {
            *byte == 0x7f || *byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0c)
        })
}
