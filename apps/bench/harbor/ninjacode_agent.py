"""Harbor BaseInstalledAgent that runs the NinjaCode CLI inside the trial container."""

from __future__ import annotations

import hashlib
import json
import math
import os
import shlex
from pathlib import Path
from typing import Any

from harbor.agents.installed.base import (
    BaseInstalledAgent,
    NonZeroAgentExitCodeError,
    with_prompt_template,
)
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

REMOTE_BUNDLE = "/installed-agent/ninjacode.cjs"
REMOTE_MANIFEST = "/installed-agent/ninjacode-manifest.json"
REMOTE_TELEMETRY = "/tmp/ninjacode-harbor-telemetry.json"
REMOTE_TRAJECTORY = "/tmp/ninjacode-harbor-trajectory.json"
REMOTE_TRAJECTORY_ARTIFACT = "/logs/artifacts/trajectory.json"
REMOTE_TIMELINE = "/tmp/ninjacode-harbor-tool-timeline.json"
REMOTE_TIMELINE_ARTIFACT = "/logs/artifacts/tool-timeline.json"
REMOTE_EVENTS = "/tmp/ninjacode-harbor-events.jsonl"
REMOTE_EVENTS_ARTIFACT = "/logs/artifacts/events.jsonl"
FAILURE_KINDS = {
    "verify_failure",
    "agent_timeout",
    "verifier_timeout",
    "agent_exit",
    "infra_error",
    "cancelled",
}
MINIMUM_FREE_KIB = 512 * 1024
REQUIRED_MANIFEST_KEYS = (
    "adapterVersion",
    "bundleSha256",
    "cliVersion",
    "gitCommit",
    "harborVersion",
    "model",
    "reasoningEffort",
    "cliRunTimeoutMs",
    "minimumNodeMajor",
    "preferredNodeVersion",
    "schemaVersion",
)

API_KEY_ENVS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "MOONSHOT_API_KEY",
    "GLM_API_KEY",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "MAMMOUTH_API_KEY",
)


def parse_harbor_model(model_name: str | None) -> tuple[str | None, str | None]:
    """Split Harbor `-m provider/model` into NinjaCode `--provider` / `--model`."""
    if not model_name:
        return None, None
    if "/" in model_name:
        provider, model = model_name.split("/", 1)
        return provider or None, model or None
    return None, model_name


def resolve_cli_bundle() -> Path:
    override = os.environ.get("NINJACODE_BUNDLE")
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parents[2] / "cli" / "dist" / "ninjacode.cjs"


def resolve_bundle_manifest(bundle: Path) -> Path:
    override = os.environ.get("NINJACODE_BUNDLE_MANIFEST")
    if override:
        return Path(override).expanduser().resolve()
    return bundle.with_name("ninjacode.harbor-manifest.json")


def load_bundle_manifest(bundle: Path) -> tuple[Path, dict[str, Any]]:
    manifest_path = resolve_bundle_manifest(bundle)
    if not manifest_path.is_file():
        raise RuntimeError(
            f"NinjaCode Harbor manifest not found at {manifest_path}. "
            "Run `ninjabench harbor ...` to regenerate it."
        )
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Invalid NinjaCode Harbor manifest: {exc}") from exc
    missing = [key for key in REQUIRED_MANIFEST_KEYS if key not in manifest]
    if missing:
        raise RuntimeError(f"NinjaCode Harbor manifest misses: {', '.join(missing)}")
    if manifest["schemaVersion"] != 3:
        raise RuntimeError(
            f"Unsupported NinjaCode Harbor manifest schema: {manifest['schemaVersion']}"
        )
    actual_hash = hashlib.sha256(bundle.read_bytes()).hexdigest()
    if manifest["bundleSha256"] != actual_hash:
        raise RuntimeError(
            "NinjaCode CLI bundle does not match its manifest. "
            "Run `ninjabench harbor ...` to regenerate both."
        )
    return manifest_path, manifest


def parse_available_kib(df_output: str) -> int:
    """Parse the Available column from POSIX `df -Pk` output."""
    lines = [line.split() for line in df_output.splitlines() if line.strip()]
    if len(lines) < 2 or len(lines[-1]) < 4:
        raise RuntimeError(f"Could not parse container disk preflight: {df_output!r}")
    try:
        return int(lines[-1][3])
    except ValueError as exc:
        raise RuntimeError(f"Invalid container disk availability: {lines[-1][3]!r}") from exc


def node_env_prefix() -> str:
    """Prefer the pinned official tarball, then a leftover nvm install."""
    return (
        'if [ -x "$HOME/.local/node/bin/node" ]; then '
        'export PATH="$HOME/.local/node/bin:$PATH"; '
        "elif [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi; "
    )


def pinned_node_install_snippet(version: str) -> str:
    """Install a fully pinned Node release from the official tarball (no nvm)."""
    return (
        "set -euo pipefail; "
        'arch="$(uname -m)"; '
        'case "$arch" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; '
        '*) echo "unsupported Node arch: $arch" >&2; exit 1;; esac; '
        f"ver={shlex.quote(version)}; "
        'prefix="$HOME/.local/node-v${ver}-linux-${arch}"; '
        'mkdir -p "$HOME/.local"; '
        "curl --fail --show-error --silent --location "
        '"https://nodejs.org/dist/v${ver}/node-v${ver}-linux-${arch}.tar.gz" '
        '| tar -xz -C "$HOME/.local"; '
        'test -x "$prefix/bin/node"; '
        'ln -sfn "$prefix" "$HOME/.local/node"; '
        'export PATH="$HOME/.local/node/bin:$PATH"; '
        'node -e "process.exit(+process.versions.node.split(\'.\')[0]>=24?0:1)"'
    )


def failure_kind_from_telemetry(telemetry: dict[str, Any]) -> str | None:
    kind = telemetry.get("failureKind")
    if isinstance(kind, str) and kind in FAILURE_KINDS:
        return kind
    status = telemetry.get("status")
    if status == "agent_timeout":
        return "agent_timeout"
    if status in {"agent_exit", "aborted"}:
        return "agent_exit"
    return None


def summarize_trajectory(
    trajectory: dict[str, Any],
    stop_reason: str | None,
    tool_histogram: dict[str, Any] | None = None,
) -> dict[str, Any]:
    events = trajectory.get("events") or []
    started = float(trajectory.get("startedAt") or 0)
    tool_events = [event for event in events if event.get("type") == "tool"]
    turn_events = [
        event
        for event in events
        if event.get("type") == "turn" and not (event.get("attributes") or {}).get("category")
    ]
    mutation_turns = {
        (event.get("attributes") or {}).get("turn")
        for event in tool_events
        if (event.get("attributes") or {}).get("mutation") is True
    }
    first_edit = next(
        (
            event
            for event in tool_events
            if (event.get("attributes") or {}).get("mutation") is True
        ),
        None,
    )
    histogram: dict[str, int] = {}
    if isinstance(tool_histogram, dict):
        for name, count in tool_histogram.items():
            if isinstance(name, str) and isinstance(count, (int, float)) and count >= 0:
                histogram[name] = int(count)
    else:
        for event in tool_events:
            name = (event.get("attributes") or {}).get("tool")
            if isinstance(name, str) and name and name != "[REDACTED]":
                histogram[name] = histogram.get(name, 0) + 1
    time_to_first = None
    if first_edit and isinstance(first_edit.get("timestamp"), (int, float)):
        time_to_first = max(0, int(first_edit["timestamp"] - started))
    longest_llm = None
    for event in events:
        duration = event.get("durationMs")
        if not isinstance(duration, (int, float)):
            continue
        attributes = event.get("attributes") or {}
        if event.get("type") != "turn" or attributes.get("category"):
            continue
        longest_llm = duration if longest_llm is None else max(longest_llm, duration)
    read_only = 0
    for event in turn_events:
        turn = (event.get("attributes") or {}).get("turn")
        if not isinstance(turn, (int, float)) or turn not in mutation_turns:
            read_only += 1
    outcome = trajectory.get("outcome") or {}
    return {
        "turns": len(turn_events),
        "timeToFirstEditMs": time_to_first,
        "longestLlmTurnMs": None if longest_llm is None else int(longest_llm),
        "readOnlyTurns": read_only,
        "toolHistogram": histogram,
        "stopReason": stop_reason,
        "completed": bool(outcome.get("completed")),
    }


class NinjaCodeAgent(BaseInstalledAgent):
    MODEL_CONNECTION = ModelConnectionSpec(
        api_key_envs=API_KEY_ENVS,
        passthrough=True,
    )

    @staticmethod
    def name() -> str:
        return "ninjacode"

    def get_version_command(self) -> str | None:
        return (
            f"{node_env_prefix()}"
            f"node -e \"const m=require('{REMOTE_MANIFEST}');"
            "console.log('cli='+m.cliVersion+',adapter='+m.adapterVersion+"
            "',commit='+m.gitCommit+',bundle='+m.bundleSha256+',node='+process.version)\""
        )

    async def install(self, environment: BaseEnvironment) -> None:
        bundle = resolve_cli_bundle()
        if not bundle.is_file():
            raise RuntimeError(
                f"NinjaCode CLI bundle not found at {bundle}. "
                "Run `pnpm --filter @ninjacode/cli bundle` first."
            )
        manifest_path, manifest = load_bundle_manifest(bundle)
        await self._preflight_container_disk(environment)
        await environment.upload_file(bundle, REMOTE_BUNDLE)
        await environment.upload_file(manifest_path, REMOTE_MANIFEST)
        node_version = await self._ensure_node(environment, manifest)
        owner = environment.default_user
        targets = f"{shlex.quote(REMOTE_BUNDLE)} {shlex.quote(REMOTE_MANIFEST)}"
        chown = f"chown {shlex.quote(str(owner))} {targets} && " if owner is not None else ""
        await self.exec_as_root(environment, command=f"{chown}chmod 755 {REMOTE_BUNDLE}")
        await self.exec_as_agent(
            environment,
            command=(
                f"{node_env_prefix()}"
                f"node -e \"const fs=require('fs'),c=require('crypto'),"
                f"m=require('{REMOTE_MANIFEST}'),b=fs.readFileSync('{REMOTE_BUNDLE}');"
                "if(c.createHash('sha256').update(b).digest('hex')!==m.bundleSha256)"
                "throw Error('uploaded bundle checksum mismatch')\""
            ),
        )
        self._manifest = manifest
        self._version = (
            f"{manifest['cliVersion']}+{str(manifest['gitCommit'])[:12]}."
            f"{str(manifest['bundleSha256'])[:12]}@node-{node_version}"
        )

    async def _preflight_container_disk(self, environment: BaseEnvironment) -> None:
        result = await environment.exec(command="df -Pk /installed-agent", user="root")
        if result.return_code != 0:
            raise RuntimeError(f"Container disk preflight failed: {result.stderr}")
        available_kib = parse_available_kib(result.stdout or "")
        if available_kib < MINIMUM_FREE_KIB:
            available_mib = available_kib // 1024
            required_mib = MINIMUM_FREE_KIB // 1024
            raise RuntimeError(
                f"Trial container has {available_mib} MiB free; "
                f"NinjaCode installation requires at least {required_mib} MiB."
            )

    async def _ensure_node(
        self, environment: BaseEnvironment, manifest: dict[str, Any]
    ) -> str:
        minimum = int(manifest["minimumNodeMajor"])
        check = (
            f"{node_env_prefix()}"
            "node -e "
            f"\"process.exit(+process.versions.node.split('.')[0]>={minimum}?0:1)\""
        )
        result = await environment.exec(command=check)
        if result.return_code != 0:
            await self.ensure_system_dependencies(environment, ("curl", "ca_certificates"))
            await self.exec_as_agent(
                environment,
                command=pinned_node_install_snippet(str(manifest["preferredNodeVersion"])),
            )
            result = await self.exec_as_agent(environment, command=check)
            if result.return_code != 0:
                version_result = await self.exec_as_agent(
                    environment,
                    command=f"{node_env_prefix()}node --version || true",
                )
                got = (version_result.stdout or "missing").strip()
                raise RuntimeError(
                    f"Pinned Node {manifest['preferredNodeVersion']} is required "
                    f"(minimum major {minimum}); container has {got}."
                )
        version_result = await self.exec_as_agent(
            environment,
            command=f"{node_env_prefix()}node --version",
        )
        return (version_result.stdout or "unknown").strip().removeprefix("v")

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        provider, model = parse_harbor_model(self.model_name)
        expected_model = str(self._manifest.get("model") or "")
        if self.model_name and expected_model and self.model_name != expected_model:
            raise RuntimeError(
                f"Harbor model {self.model_name!r} does not match pinned manifest "
                f"model {expected_model!r}"
            )
        cmd = [
            "node",
            REMOTE_BUNDLE,
            "run",
            instruction,
            "--yes",
            "--sandbox",
            "danger-full-access",
            "--no-checkpoints",
            "--lang",
            "en",
            "--reasoning-effort",
            str(self._manifest["reasoningEffort"]),
            "--run-timeout-ms",
            str(self._manifest["cliRunTimeoutMs"]),
        ]
        if provider:
            cmd.extend(["--provider", provider])
        if model:
            cmd.extend(["--model", model])
        command = (
            "rm -f "
            + shlex.quote(REMOTE_TELEMETRY)
            + " "
            + shlex.quote(REMOTE_TRAJECTORY)
            + " "
            + shlex.quote(REMOTE_TIMELINE)
            + " "
            + shlex.quote(REMOTE_EVENTS)
            + f"; {node_env_prefix()}"
            + shlex.join(cmd)
        )
        # Harbor does not automatically copy host API keys into the trial
        # container. Pass them as exec env (never as CLI flags — those are logged).
        env = self._container_api_env()
        if not env:
            raise RuntimeError(
                "No provider API key on the host. Export XAI_API_KEY (or the "
                "key for `-m provider/model`) in the same shell as Harbor."
            )
        env["NINJACODE_BENCH_TELEMETRY_FILE"] = REMOTE_TELEMETRY
        env["NINJACODE_TRAJECTORY_FILE"] = REMOTE_TRAJECTORY
        ablation = (getattr(self, "_manifest", {}).get("ablation") or {}).get("name")
        if ablation:
            env["NINJACODE_PERF_ABLATION"] = str(ablation)
        captured_exit: BaseException | None = None
        try:
            await self.exec_as_agent(environment, command=command, env=env)
        except NonZeroAgentExitCodeError as exc:
            captured_exit = exc
        finally:
            await self._collect_telemetry(environment, context)
            await self._collect_trajectory(environment, context)
            await self._collect_tool_timeline(environment, context)
            await self._copy_artifact_if_present(environment, REMOTE_EVENTS, REMOTE_EVENTS_ARTIFACT)
        if captured_exit is not None and not (context.metadata or {}).get(
            "telemetry_complete"
        ):
            raise captured_exit

    async def _collect_telemetry(
        self, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        result = await environment.exec(
            command=f"test -s {REMOTE_TELEMETRY} && cat {REMOTE_TELEMETRY}"
        )
        metadata = {
            "ninjacode_manifest": getattr(self, "_manifest", {}),
            "telemetry_available": False,
            "telemetry_complete": False,
        }
        if result.return_code != 0:
            context.metadata = {**(context.metadata or {}), **metadata}
            return
        try:
            telemetry = json.loads(result.stdout or "")
        except json.JSONDecodeError:
            metadata["telemetry_error"] = "invalid_json"
            context.metadata = {**(context.metadata or {}), **metadata}
            return
        if telemetry.get("schemaVersion") != 1:
            metadata["telemetry_error"] = "unsupported_schema"
            context.metadata = {**(context.metadata or {}), **metadata}
            return
        metric_names = (
            "inputTokens",
            "cacheReadTokens",
            "cacheWriteTokens",
            "outputTokens",
            "estimatedCostUsd",
            "turns",
            "toolCalls",
            "toolErrors",
        )
        try:
            metrics = {name: float(telemetry[name]) for name in metric_names}
            if any(not math.isfinite(value) or value < 0 for value in metrics.values()):
                raise ValueError("metrics must be finite and non-negative")
            input_tokens = int(metrics["inputTokens"])
            cache_tokens = int(metrics["cacheReadTokens"])
            output_tokens = int(metrics["outputTokens"])
            cost = metrics["estimatedCostUsd"]
        except (KeyError, TypeError, ValueError):
            metadata["telemetry_error"] = "invalid_metrics"
            context.metadata = {**(context.metadata or {}), **metadata}
            return
        context.n_input_tokens = input_tokens + cache_tokens
        context.n_cache_tokens = cache_tokens
        context.n_output_tokens = output_tokens
        context.cost_usd = cost if cost > 0 else None
        metadata.update(
            {
                "telemetry_available": True,
                "telemetry_complete": bool(telemetry.get("telemetryComplete", True)),
                "telemetry_status": telemetry.get("status", "completed"),
                "failure_kind": failure_kind_from_telemetry(telemetry),
                "stop_reason": telemetry.get("stopReason"),
                "cache_write_tokens": int(metrics["cacheWriteTokens"]),
                "completed": bool(telemetry.get("completed")),
                "session_id": telemetry.get("sessionId"),
                "tool_calls": int(metrics["toolCalls"]),
                "tool_errors": int(metrics["toolErrors"]),
                "tool_histogram": telemetry.get("toolHistogram") or {},
                "turns": int(metrics["turns"]),
                "benchmark_config": telemetry.get("config") or {},
            }
        )
        context.metadata = {**(context.metadata or {}), **metadata}

    async def _collect_trajectory(
        self, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        metadata = dict(context.metadata or {})
        result = await environment.exec(
            command=f"test -s {REMOTE_TRAJECTORY} && cat {REMOTE_TRAJECTORY}"
        )
        if result.return_code != 0:
            metadata["trajectory_available"] = False
            context.metadata = metadata
            return
        try:
            trajectory = json.loads(result.stdout or "")
        except json.JSONDecodeError:
            metadata["trajectory_available"] = False
            metadata["trajectory_error"] = "invalid_json"
            context.metadata = metadata
            return
        if not isinstance(trajectory, dict) or trajectory.get("schemaVersion") != "1.0":
            metadata["trajectory_available"] = False
            metadata["trajectory_error"] = "unsupported_schema"
            context.metadata = metadata
            return
        stop_reason = metadata.get("stop_reason")
        if not isinstance(stop_reason, str):
            stop_reason = None
        metadata["trajectory_available"] = True
        metadata["trajectory"] = summarize_trajectory(
            trajectory,
            stop_reason,
            metadata.get("tool_histogram") if isinstance(metadata.get("tool_histogram"), dict) else None,
        )
        context.metadata = metadata
        await self._copy_artifact_if_present(
            environment, REMOTE_TRAJECTORY, REMOTE_TRAJECTORY_ARTIFACT
        )

    async def _collect_tool_timeline(
        self, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        metadata = dict(context.metadata or {})
        result = await environment.exec(
            command=f"test -s {REMOTE_TIMELINE} && cat {REMOTE_TIMELINE}"
        )
        if result.return_code != 0:
            metadata["tool_timeline_available"] = False
            context.metadata = metadata
            return
        try:
            timeline = json.loads(result.stdout or "")
        except json.JSONDecodeError:
            metadata["tool_timeline_available"] = False
            metadata["tool_timeline_error"] = "invalid_json"
            context.metadata = metadata
            return
        if not isinstance(timeline, dict) or timeline.get("schemaVersion") != "1.0":
            metadata["tool_timeline_available"] = False
            metadata["tool_timeline_error"] = "unsupported_schema"
            context.metadata = metadata
            return
        tools = timeline.get("tools") if isinstance(timeline.get("tools"), list) else []
        turns = timeline.get("turns") if isinstance(timeline.get("turns"), list) else []
        max_batch = 0
        for tool in tools:
            if isinstance(tool, dict) and isinstance(tool.get("batchSize"), int):
                max_batch = max(max_batch, tool["batchSize"])
        metadata["tool_timeline_available"] = True
        metadata["tool_timeline"] = {
            "tools": len(tools),
            "turns": len(turns),
            "maxBatchSize": max_batch,
        }
        context.metadata = metadata
        await self._copy_artifact_if_present(
            environment, REMOTE_TIMELINE, REMOTE_TIMELINE_ARTIFACT
        )

    async def _copy_artifact_if_present(
        self,
        environment: BaseEnvironment,
        source: str,
        destination: str,
    ) -> None:
        await environment.exec(
            command=(
                "if [ -d /logs/artifacts ] && [ -s "
                + shlex.quote(source)
                + " ]; then cp "
                + shlex.quote(source)
                + " "
                + shlex.quote(destination)
                + "; fi"
            )
        )

    def _container_api_env(self) -> dict[str, str]:
        env: dict[str, str] = {}
        for name in API_KEY_ENVS:
            value = self._get_env(name)
            if value:
                env[name] = value
        connection = self.model_connection
        if connection.api_key:
            provider, _ = parse_harbor_model(self.model_name)
            key_name = (
                f"{provider.upper().replace('-', '_')}_API_KEY"
                if provider
                else "XAI_API_KEY"
            )
            env.setdefault(key_name, connection.api_key)
        return env
