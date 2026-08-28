{
  "targets": [{
    "target_name": "secure_fs",
    "sources": ["secure_fs.cc"],
    "conditions": [["OS=='win'", { "defines": ["_CRT_SECURE_NO_WARNINGS"] }]]
  }]
}
