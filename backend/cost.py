"""Cost tracking for OpenRouter model calls.

OpenRouter returns a `usage` object on every chat completion containing the
actual USD `cost`. This module reads that, with a cached pricing table as a
defensive fallback for the rare model that omits `cost`.
"""

import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger('council.cost')

# model_id -> {"prompt": float, "completion": float}  (USD per token)
_pricing_cache: Dict[str, Dict[str, float]] = {}
_pricing_fetched_at: Optional[float] = None
_PRICING_TTL = 3600  # seconds


async def get_pricing_table() -> Dict[str, Dict[str, float]]:
    """Return the cached model pricing table, refreshing it if stale."""
    global _pricing_fetched_at

    fresh = (
        _pricing_fetched_at is not None
        and (time.monotonic() - _pricing_fetched_at) < _PRICING_TTL
    )
    if _pricing_cache and fresh:
        return _pricing_cache

    # Lazy import — openrouter.py imports this module, so a top-level
    # import would be circular.
    from .openrouter import fetch_available_models

    try:
        models = await fetch_available_models()
    except Exception as e:
        logger.warning(f"Pricing fetch failed ({e}); using stale cache.")
        return _pricing_cache

    for model in models:
        pricing = model.get('pricing') or {}
        try:
            prompt = float(pricing.get('prompt', 0) or 0)
            completion = float(pricing.get('completion', 0) or 0)
        except (TypeError, ValueError):
            continue
        if model.get('id'):
            _pricing_cache[model['id']] = {
                'prompt': prompt,
                'completion': completion,
            }

    _pricing_fetched_at = time.monotonic()
    logger.info(f"Pricing table cached: {len(_pricing_cache)} models.")
    return _pricing_cache


async def warm_pricing_cache() -> None:
    """Populate the pricing cache so extract_cost() has fallback data."""
    await get_pricing_table()


def extract_cost(response: Optional[Dict[str, Any]],
                 model: Optional[str] = None) -> Dict[str, Any]:
    """
    Derive the cost of a single model call. Never raises.

    Prefers OpenRouter's authoritative `usage.cost`; falls back to
    tokens x cached pricing if cost is missing.

    Returns: {cost, prompt_tokens, completion_tokens, total_tokens, estimated}
    """
    zero = {
        'cost': 0.0,
        'prompt_tokens': 0,
        'completion_tokens': 0,
        'total_tokens': 0,
        'estimated': False,
    }
    if not response:
        # A failed call genuinely cost nothing.
        return zero

    usage = response.get('usage')
    if not isinstance(usage, dict):
        # No usage data at all — can't know, treat as unestimated zero.
        return {**zero, 'estimated': True}

    def _int(key: str) -> int:
        try:
            return int(usage.get(key, 0) or 0)
        except (TypeError, ValueError):
            return 0

    prompt_tokens = _int('prompt_tokens')
    completion_tokens = _int('completion_tokens')
    total_tokens = _int('total_tokens') or (prompt_tokens + completion_tokens)

    # Authoritative path: OpenRouter's own cost figure.
    raw_cost = usage.get('cost')
    try:
        cost = float(raw_cost) if raw_cost is not None else 0.0
    except (TypeError, ValueError):
        cost = 0.0

    if cost > 0:
        return {
            'cost': cost,
            'prompt_tokens': prompt_tokens,
            'completion_tokens': completion_tokens,
            'total_tokens': total_tokens,
            'estimated': False,
        }

    # Fallback: estimate from cached pricing.
    if model and model in _pricing_cache:
        price = _pricing_cache[model]
        estimated_cost = (
            prompt_tokens * price['prompt']
            + completion_tokens * price['completion']
        )
        return {
            'cost': estimated_cost,
            'prompt_tokens': prompt_tokens,
            'completion_tokens': completion_tokens,
            'total_tokens': total_tokens,
            'estimated': True,
        }

    # No cost and no pricing — surface zero rather than crash.
    return {
        'cost': 0.0,
        'prompt_tokens': prompt_tokens,
        'completion_tokens': completion_tokens,
        'total_tokens': total_tokens,
        'estimated': True,
    }
