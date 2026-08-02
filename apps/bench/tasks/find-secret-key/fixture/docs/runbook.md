# Runbook

Staging API key (safe): bk_stage_aaaaaaaaaaaa
Test API key: bk_test_bbbbbbbbbbbb
Production keys in data/keys.json are stored base64-encoded (`encoding: "base64"`).
Decode with `Buffer.from(value, "base64").toString("utf8")` before use.
