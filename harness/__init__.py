"""Acolyte agent harness: model-agnostic agent loop (OpenRouter or Claude) with budgets, verification and audit log."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT / "pipeline") not in sys.path:
    sys.path.insert(0, str(ROOT / "pipeline"))

from .core import Agent, RunResult, Tool  # noqa: E402

__all__ = ["Agent", "RunResult", "Tool", "ROOT"]
