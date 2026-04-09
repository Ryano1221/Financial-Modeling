"""
Shared LLM provider selection for the extraction pipeline.

Set LLM_PROVIDER=anthropic to use Anthropic Claude instead of OpenAI.
When LLM_PROVIDER=anthropic, structured extractors use the native Anthropic SDK
with tool_use for guaranteed JSON schema output. Simpler chat paths use the
OpenAI-compatible endpoint for a minimal code delta.

Required env vars:
  LLM_PROVIDER        "openai" (default) | "anthropic"
  OPENAI_API_KEY      required when LLM_PROVIDER=openai
  ANTHROPIC_API_KEY   required when LLM_PROVIDER=anthropic
  ANTHROPIC_MODEL     Claude model (default: claude-sonnet-4-6)
  OPENAI_LEASE_MODEL  comma-separated OpenAI model list for chat paths
                      (default: gpt-4o-mini,gpt-4.1-mini,gpt-4.1)
  OPENAI_EXTRACTION_MODEL  OpenAI model for structured extractor
                           (default: gpt-4.1-mini)
"""
from __future__ import annotations

import os

_PROVIDER = (os.environ.get("LLM_PROVIDER") or "openai").strip().lower()
ANTHROPIC_MODEL_DEFAULT = "claude-sonnet-4-6"


def get_provider() -> str:
    """Return the active provider name: 'openai' or 'anthropic'."""
    return _PROVIDER


def is_anthropic() -> bool:
    return _PROVIDER == "anthropic"


def ai_enabled() -> bool:
    """True if an API key for the active provider is set."""
    if is_anthropic():
        return bool((os.environ.get("ANTHROPIC_API_KEY") or "").strip())
    return bool((os.environ.get("OPENAI_API_KEY") or "").strip())


def get_api_key() -> str:
    """Return the active provider API key, or raise ValueError."""
    if is_anthropic():
        key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not key:
            raise ValueError("ANTHROPIC_API_KEY not configured")
        return key
    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")
    return key


def get_anthropic_model() -> str:
    return (os.environ.get("ANTHROPIC_MODEL") or ANTHROPIC_MODEL_DEFAULT).strip()


def make_openai_client(timeout: float = 60.0):
    """Native OpenAI client."""
    from openai import OpenAI  # type: ignore
    return OpenAI(api_key=get_api_key(), timeout=timeout)


def make_anthropic_client():
    """Native Anthropic client."""
    from anthropic import Anthropic  # type: ignore
    return Anthropic(api_key=get_api_key())


def make_openai_compat_client(timeout: float = 60.0):
    """
    OpenAI-compatible client pointed at Anthropic's compatibility endpoint.
    Suitable for simple chat.completions.create calls only.
    NOT for structured output — use make_anthropic_client() + tool_use for that.
    """
    from openai import OpenAI  # type: ignore
    return OpenAI(
        api_key=get_api_key(),
        base_url="https://api.anthropic.com/v1/",
        timeout=timeout,
    )
