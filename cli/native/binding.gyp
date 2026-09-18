{
  "targets": [{
    "target_name": "secure_fs",
    "sources": ["secure_fs.cc"],
    "conditions": [["OS=='win'", { "defines": ["_CRT_SECURE_NO_WARNINGS"] }]]
  }, {
    "target_name": "secure_fs_test",
    "sources": ["secure_fs.cc"],
    "defines": ["AWM_SECURE_FS_TESTING=1"],
    "conditions": [["OS=='win'", { "defines": ["_CRT_SECURE_NO_WARNINGS", "AWM_SECURE_FS_TESTING=1"] }]]
  }]
}
