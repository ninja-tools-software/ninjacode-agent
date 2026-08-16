"""Offline unit tests for the Harbor adapter (Harbor itself is stubbed)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace


def _stub_module(name: str, **attributes: object) -> None:
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module


class _BaseInstalledAgent:
    pass


def _with_prompt_template(function):
    return function


class _ModelConnectionSpec:
    def __init__(self, **_kwargs):
        pass


_stub_module(
    "harbor.agents.installed.base",
    BaseInstalledAgent=_BaseInstalledAgent,
    with_prompt_template=_with_prompt_template,
)
_stub_module("harbor.agents.model_connection", ModelConnectionSpec=_ModelConnectionSpec)
_stub_module("harbor.environments.base", BaseEnvironment=object)
_stub_module("harbor.models.agent.context", AgentContext=object)

MODULE_PATH = Path(__file__).with_name("ninjacode_agent.py")
SPEC = importlib.util.spec_from_file_location("ninjacode_agent_under_test", MODULE_PATH)
assert SPEC and SPEC.loader
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)


class HarborAdapterTests(unittest.TestCase):
    def test_parses_container_disk_available_column(self) -> None:
        output = (
            "Filesystem 1024-blocks Used Available Capacity Mounted on\n"
            "overlay 1048576 1000 1047576 1% /\n"
        )
        self.assertEqual(ADAPTER.parse_available_kib(output), 1047576)
        with self.assertRaisesRegex(RuntimeError, "Could not parse"):
            ADAPTER.parse_available_kib("garbage")

    def test_manifest_must_match_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle = Path(temp_dir) / "ninjacode.cjs"
            bundle.write_bytes(b"bundle")
            digest = __import__("hashlib").sha256(b"bundle").hexdigest()
            manifest = {
                "schemaVersion": 1,
                "adapterVersion": "1.0.0",
                "cliVersion": "0.1.0",
                "gitCommit": "abc",
                "bundleSha256": digest,
                "minimumNodeMajor": 20,
                "preferredNodeVersion": "22.17.1",
            }
            bundle.with_name("ninjacode.harbor-manifest.json").write_text(
                json.dumps(manifest)
            )
            _, loaded = ADAPTER.load_bundle_manifest(bundle)
            self.assertEqual(loaded["gitCommit"], "abc")
            bundle.write_bytes(b"changed")
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                ADAPTER.load_bundle_manifest(bundle)

    def test_node_fallback_is_fully_pinned(self) -> None:
        snippet = ADAPTER.pinned_node_install_snippet("22.17.1")
        self.assertIn("nvm/v0.40.2/install.sh", snippet)
        self.assertIn("nvm install 22.17.1", snippet)
        self.assertIn("curl --fail", snippet)

    def test_maps_cli_telemetry_to_harbor_context(self) -> None:
        telemetry = {
            "schemaVersion": 1,
            "completed": True,
            "sessionId": "session-1",
            "inputTokens": 100,
            "outputTokens": 50,
            "cacheReadTokens": 200,
            "cacheWriteTokens": 25,
            "estimatedCostUsd": 0.012,
            "turns": 3,
            "toolCalls": 4,
            "toolErrors": 1,
            "toolHistogram": {"read_file": 2},
        }

        class Environment:
            async def exec(self, **_kwargs):
                return SimpleNamespace(return_code=0, stdout=json.dumps(telemetry))

        context = SimpleNamespace(
            metadata=None,
            n_input_tokens=None,
            n_cache_tokens=None,
            n_output_tokens=None,
            cost_usd=None,
        )
        agent = object.__new__(ADAPTER.NinjaCodeAgent)
        agent._manifest = {"gitCommit": "abc"}
        asyncio.run(agent._collect_telemetry(Environment(), context))
        self.assertEqual(context.n_input_tokens, 300)
        self.assertEqual(context.n_cache_tokens, 200)
        self.assertEqual(context.n_output_tokens, 50)
        self.assertEqual(context.metadata["tool_errors"], 1)
        self.assertTrue(context.metadata["telemetry_available"])


if __name__ == "__main__":
    unittest.main()
