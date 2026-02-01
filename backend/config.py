"""Configuration for the LLM Council."""

import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger('council.config')

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Log API key status at startup
if OPENROUTER_API_KEY:
    logger.info(f"OpenRouter API key loaded: {OPENROUTER_API_KEY[:8]}...{OPENROUTER_API_KEY[-4:]}")
else:
    logger.error("!!! OPENROUTER_API_KEY not found in environment! API calls will fail. !!!")

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Data directory for conversation storage
DATA_DIR = "data/conversations"

# Config file path for persistent council configuration
CONFIG_FILE = "data/council_config.json"


def _ensure_config_dir():
    """Ensure the config directory exists."""
    Path(CONFIG_FILE).parent.mkdir(parents=True, exist_ok=True)


def _load_council_config():
    """Load council configuration from persistent storage."""
    _ensure_config_dir()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    # Return empty config if no file exists - user must configure
    return {"council_models": [], "chairman_model": ""}


def save_council_config(council_models: list, chairman_model: str):
    """Save council configuration to persistent storage."""
    _ensure_config_dir()
    config = {
        "council_models": council_models,
        "chairman_model": chairman_model
    }
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


def get_council_models():
    """Get current council models from persistent storage."""
    return _load_council_config().get("council_models", [])


def get_chairman_model():
    """Get current chairman model from persistent storage."""
    return _load_council_config().get("chairman_model", "")


# For backward compatibility - these will be updated dynamically
_config = _load_council_config()
COUNCIL_MODELS = _config.get("council_models", [])
CHAIRMAN_MODEL = _config.get("chairman_model", "")

# Log council config at startup
if COUNCIL_MODELS:
    logger.info(f"Council models configured: {COUNCIL_MODELS}")
else:
    logger.warning("No council models configured! Please configure models in the UI.")
if CHAIRMAN_MODEL:
    logger.info(f"Chairman model: {CHAIRMAN_MODEL}")
else:
    logger.warning("No chairman model configured!")
