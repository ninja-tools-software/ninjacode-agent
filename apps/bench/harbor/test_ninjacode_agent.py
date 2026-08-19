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


class _NonZeroAgentExitCodeError(RuntimeError):
    pass


_stub_module(
    "harbor.agents.installed.base",
    BaseInstalledAgent=_BaseInstalledAgent,
    with_prompt_template=_with_prompt_template,
    NonZeroAgentExitCodeError=_NonZeroAgentExitCodeError,
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
                "schemaVersion": 3,
                "adapterVersion": "1.2.0",
                "cliVersion": "0.1.0",
                "gitCommit": "abc",
                "gitTreeDirty": False,
                "harborVersion": "0.21.0",
                "model": "xai/grok-4.6",
                "reasoningEffort": "xhigh",
                "cliRunTimeoutMs": 840000,
                "bundleSha256": digest,
                "minimumNodeMajor": 24,
                "preferredNodeVersion": "24.19.0",
            }
            bundle.with_name("ninjacode.harbor-manifest.json").write_text(
                json.dumps(manifest)
            )
            _, loaded = ADAPTER.load_bundle_manifest(bundle)
            self.assertEqual(loaded["gitCommit"], "abc")
            bundle.write_bytes(b"changed")
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                ADAPTER.load_bundle_manifest(bundle)

    def test_manifest_rejects_stale_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle = Path(temp_dir) / "ninjacode.cjs"
            bundle.write_bytes(b"bundle")
            digest = __import__("hashlib").sha256(b"bundle").hexdigest()
            manifest = {
                "schemaVersion": 2,
                "adapterVersion": "1.0.0",
                "cliVersion": "0.1.0",
                "gitCommit": "abc",
                "harborVersion": "0.21.0",
                "model": "xai/grok-4.6",
                "reasoningEffort": "high",
                "cliRunTimeoutMs": 840000,
                "bundleSha256": digest,
                "minimumNodeMajor": 24,
                "preferredNodeVersion": "24.19.0",
            }
            bundle.with_name("ninjacode.harbor-manifest.json").write_text(
                json.dumps(manifest)
            )
            with self.assertRaisesRegex(RuntimeError, "schema: 2"):
                ADAPTER.load_bundle_manifest(bundle)

    def test_node_fallback_is_fully_pinned(self) -> None:
        snippet = ADAPTER.pinned_node_install_snippet("24.19.0")
        self.assertIn("nodejs.org/dist/v${ver}/node-v${ver}-linux-${arch}.tar.gz", snippet)
        self.assertIn("24.19.0", snippet)
        self.assertIn("curl --fail", snippet)
        self.assertIn("set -euo pipefail", snippet)
        self.assertIn('test -x "$prefix/bin/node"', snippet)
        self.assertNotIn("nvm", snippet)
        self.assertNotIn("nodejs", snippet.split("nodejs.org")[0])
        self.assertIn("$HOME/.local/node/bin", ADAPTER.node_env_prefix())

    def test_maps_cli_telemetry_to_harbor_context(self) -> None:
        telemetry = {
            "schemaVersion": 1,
            "status": "completed",
            "telemetryComplete": True,
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
        self.assertTrue(context.metadata["telemetry_complete"])
        self.assertIsNone(context.metadata["failure_kind"])

    def test_timeout_telemetry_sets_agent_timeout_failure_kind(self) -> None:
        telemetry = {
            "schemaVersion": 1,
            "status": "agent_timeout",
            "telemetryComplete": True,
            "completed": False,
            "stopReason": "timeout",
            "failureKind": "agent_timeout",
            "sessionId": "session-1",
            "inputTokens": 10,
            "outputTokens": 5,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "estimatedCostUsd": 0.01,
            "turns": 2,
            "toolCalls": 1,
            "toolErrors": 0,
            "toolHistogram": {"read_file": 1},
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
        self.assertEqual(context.metadata["failure_kind"], "agent_timeout")
        self.assertEqual(context.metadata["stop_reason"], "timeout")
        self.assertTrue(context.metadata["telemetry_complete"])

    def test_invalid_telemetry_is_never_marked_available(self) -> None:
        class Environment:
            async def exec(self, **_kwargs):
                return SimpleNamespace(return_code=0, stdout="{invalid")

        context = SimpleNamespace(metadata=None)
        agent = object.__new__(ADAPTER.NinjaCodeAgent)
        agent._manifest = {}
        asyncio.run(agent._collect_telemetry(Environment(), context))
        self.assertFalse(context.metadata["telemetry_available"])
        self.assertEqual(context.metadata["telemetry_error"], "invalid_json")

    def test_summarizes_redacted_trajectory_without_prompts(self) -> None:
        summary = ADAPTER.summarize_trajectory(
            {
                "schemaVersion": "1.0",
                "startedAt": 1000,
                "outcome": {"completed": False},
                "events": [
                    {"type": "turn", "attributes": {"turn": 1}},
                    {
                        "type": "tool",
                        "timestamp": 1300,
                        "attributes": {"tool": "write_file", "mutation": True, "turn": 1},
                    },
                    {"type": "turn", "attributes": {"turn": 2}},
                    {
                        "type": "tool",
                        "timestamp": 1600,
                        "attributes": {"tool": "read_file", "mutation": False, "turn": 2},
                    },
                ],
            },
            "timeout",
            {"write_file": 1, "read_file": 1},
        )
        self.assertEqual(summary["turns"], 2)
        self.assertEqual(summary["timeToFirstEditMs"], 300)
        self.assertEqual(summary["readOnlyTurns"], 1)
        self.assertEqual(summary["toolHistogram"], {"write_file": 1, "read_file": 1})
        self.assertEqual(summary["stopReason"], "timeout")
        self.assertNotIn("prompt", summary)
        self.assertNotIn("events", summary)

    def test_nonzero_exit_with_complete_telemetry_is_scorable(self) -> None:
        telemetry = {
            "schemaVersion": 1,
            "status": "agent_timeout",
            "telemetryComplete": True,
            "completed": False,
            "stopReason": "timeout",
            "failureKind": "agent_timeout",
            "inputTokens": 1,
            "outputTokens": 1,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "estimatedCostUsd": 0,
            "turns": 1,
            "toolCalls": 0,
            "toolErrors": 0,
            "toolHistogram": {},
        }
        trajectory = {
            "schemaVersion": "1.0",
            "startedAt": 1,
            "outcome": {"completed": False},
            "events": [{"type": "turn", "attributes": {"turn": 1}}],
        }
        copied = []

        class Environment:
            async def exec(self, command="", **_kwargs):
                if ADAPTER.REMOTE_TELEMETRY in command and "cat" in command:
                    return SimpleNamespace(return_code=0, stdout=json.dumps(telemetry))
                if ADAPTER.REMOTE_TRAJECTORY in command and "cat" in command:
                    return SimpleNamespace(return_code=0, stdout=json.dumps(trajectory))
                if "/logs/artifacts" in command:
                    copied.append(command)
                    return SimpleNamespace(return_code=0, stdout="")
                return SimpleNamespace(return_code=0, stdout="")

        class Agent(ADAPTER.NinjaCodeAgent):
            async def exec_as_agent(self, *_args, **_kwargs):
                raise _NonZeroAgentExitCodeError("exit 2")

        context = SimpleNamespace(metadata=None, n_input_tokens=None, n_cache_tokens=None, n_output_tokens=None, cost_usd=None)
        agent = Agent()
        agent._manifest = {
            "reasoningEffort": "high",
            "cliRunTimeoutMs": 840000,
            "model": "xai/grok-4.6",
        }
        agent.model_name = "xai/grok-4.6"
        agent._container_api_env = lambda: {"XAI_API_KEY": "test"}
        asyncio.run(agent.run("do the task", Environment(), context))
        self.assertTrue(context.metadata["telemetry_complete"])
        self.assertEqual(context.metadata["failure_kind"], "agent_timeout")
        self.assertTrue(context.metadata["trajectory_available"])
        self.assertEqual(context.metadata["trajectory"]["stopReason"], "timeout")
        self.assertTrue(copied)

    def test_node_install_requests_ca_certificates_not_hyphenated(self) -> None:
        called: list[object] = []

        class Environment:
            async def exec(self, **_kwargs):
                return SimpleNamespace(return_code=1, stdout="", stderr="missing node")

        class Agent(ADAPTER.NinjaCodeAgent):
            async def ensure_system_dependencies(self, _environment, packages):
                called.append(packages)

            async def exec_as_agent(self, _environment, command="", **_kwargs):
                if "nodejs.org/dist" in command:
                    return SimpleNamespace(return_code=0, stdout="")
                if "process.versions.node" in command:
                    return SimpleNamespace(return_code=0, stdout="")
                if "node --version" in command:
                    return SimpleNamespace(return_code=0, stdout="v24.19.0")
                return SimpleNamespace(return_code=0, stdout="v24.19.0")

        agent = Agent()
        version = asyncio.run(
            agent._ensure_node(
                Environment(),
                {"minimumNodeMajor": 24, "preferredNodeVersion": "24.19.0"},
            )
        )
        self.assertEqual(called, [("curl", "ca_certificates")])
        self.assertEqual(version, "24.19.0")
        self.assertNotIn("ca-certificates", str(called))

    def test_summarizes_longest_llm_turn_from_turn_events(self) -> None:
        summary = ADAPTER.summarize_trajectory(
            {
                "schemaVersion": "1.0",
                "startedAt": 1000,
                "outcome": {"completed": False},
                "events": [
                    {"type": "turn", "durationMs": 5100, "attributes": {"turn": 1}},
                    {"type": "turn", "durationMs": 2400, "attributes": {"turn": 2}},
                    {
                        "type": "turn",
                        "durationMs": 9999,
                        "attributes": {"turn": 3, "category": "compaction_usage"},
                    },
                ],
            },
            "timeout",
        )
        self.assertEqual(summary["longestLlmTurnMs"], 5100)
        self.assertEqual(summary["turns"], 2)

    def test_nonzero_exit_without_telemetry_is_reraised(self) -> None:
        class Environment:
            async def exec(self, **_kwargs):
                return SimpleNamespace(return_code=1, stdout="")

        class Agent(ADAPTER.NinjaCodeAgent):
            async def exec_as_agent(self, *_args, **_kwargs):
                raise _NonZeroAgentExitCodeError("exit 2")

        context = SimpleNamespace(metadata=None)
        agent = Agent()
        agent._manifest = {
            "reasoningEffort": "high",
            "cliRunTimeoutMs": 840000,
            "model": "xai/grok-4.6",
        }
        agent.model_name = "xai/grok-4.6"
        agent._container_api_env = lambda: {"XAI_API_KEY": "test"}
        with self.assertRaises(_NonZeroAgentExitCodeError):
            asyncio.run(agent.run("do the task", Environment(), context))
        self.assertFalse(context.metadata["telemetry_complete"])


if __name__ == "__main__":
    unittest.main()
