"""Harbor BaseInstalledAgent that runs the NinjaCode CLI inside the trial container."""

from __future__ import annotations

import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

REMOTE_BUNDLE = "/installed-agent/ninjacode.cjs"

API_KEY_ENVS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "MOONSHOT_API_KEY",
    "GLM_API_KEY",
    "MISTRAL_API_KEY",
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
            "if [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi; "
            f"test -f {shlex.quote(REMOTE_BUNDLE)} && echo 0.1.0"
        )

    async def install(self, environment: BaseEnvironment) -> None:
        bundle = resolve_cli_bundle()
        if not bundle.is_file():
            raise RuntimeError(
                f"NinjaCode CLI bundle not found at {bundle}. "
                "Run `pnpm --filter @ninjacode/cli bundle` first."
            )

        await self.ensure_system_dependencies(environment, ("curl",))
        await self.exec_as_agent(
            environment,
            command=f"set -euo pipefail; {nvm_node_install_snippet()}",
        )
        await environment.upload_file(bundle, REMOTE_BUNDLE)
        quoted = shlex.quote(REMOTE_BUNDLE)
        owner = environment.default_user
        chown = f"chown {shlex.quote(str(owner))} {quoted} && " if owner is not None else ""
        await self.exec_as_root(environment, command=f"{chown}chmod 755 {quoted}")

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        provider, model = parse_harbor_model(self.model_name)
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
        ]
        if provider:
            cmd.extend(["--provider", provider])
        if model:
            cmd.extend(["--model", model])
        command = (
            "if [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi; " + shlex.join(cmd)
        )
        await self.exec_as_agent(environment, command=command)
