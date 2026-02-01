"""OpenRouter API client for making LLM requests."""

import logging
import httpx
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL

logger = logging.getLogger('council.openrouter')


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.
    No timeout - let the model respond as long as it needs.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        logger.info(f"  → Calling {model}...")
        # No read timeout - only connect timeout to detect unreachable servers
        timeout_config = httpx.Timeout(None, connect=60.0)
        async with httpx.AsyncClient(timeout=timeout_config) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            
            # Log the raw response structure for debugging
            if 'choices' not in data:
                logger.error(f"  ✗ {model} - No 'choices' in response: {str(data)[:500]}")
                return None
            
            if len(data['choices']) == 0:
                logger.error(f"  ✗ {model} - Empty 'choices' array")
                return None
                
            message = data['choices'][0].get('message')
            if not message:
                logger.error(f"  ✗ {model} - No 'message' in choice: {str(data['choices'][0])[:500]}")
                return None
            
            content = message.get('content', '')
            logger.info(f"  ← {model} responded ({len(content)} chars)")

            return {
                'content': content,
                'reasoning_details': message.get('reasoning_details')
            }

    except httpx.TimeoutException:
        logger.error(f"  ✗ {model} CONNECTION TIMEOUT (server unreachable)")
        return None
    except httpx.HTTPStatusError as e:
        logger.error(f"  ✗ {model} HTTP ERROR: {e.response.status_code} - {e.response.text[:500]}")
        return None
    except KeyError as e:
        logger.error(f"  ✗ {model} KEY ERROR: Missing key {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None
    except Exception as e:
        logger.error(f"  ✗ {model} ERROR: {type(e).__name__}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel. No timeout - let models respond as long as needed.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    logger.info(f"Querying {len(models)} models in parallel: {models}")
    
    # Create tasks for all models - no timeout wrapper
    tasks = [query_model(model, messages) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Handle any exceptions that slipped through
    processed_responses = []
    for i, resp in enumerate(responses):
        if isinstance(resp, Exception):
            logger.error(f"  ✗ {models[i]} EXCEPTION: {type(resp).__name__}: {resp}")
            processed_responses.append(None)
        else:
            processed_responses.append(resp)

    # Count successes/failures
    success_count = sum(1 for r in processed_responses if r is not None)
    logger.info(f"Parallel query complete: {success_count}/{len(models)} succeeded")

    # Map models to their responses
    return {model: response for model, response in zip(models, processed_responses)}


async def stream_model(
    model: str,
    messages: List[Dict[str, str]],
    on_chunk: callable,
) -> Optional[Dict[str, Any]]:
    """
    Stream a response from a model, calling on_chunk for each text chunk.
    No timeout - let the model respond as long as it needs.
    
    Args:
        model: OpenRouter model identifier
        messages: List of message dicts
        on_chunk: Async callback(text_chunk) called for each chunk of text
    
    Returns:
        Final response dict with full 'content', or None if failed
    """
    import json
    
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }

    full_content = ""
    
    try:
        logger.info(f"  → Streaming {model}...")
        # No timeout - let models respond as long as they need
        # Only set a connect timeout to detect if the server is unreachable
        timeout_config = httpx.Timeout(None, connect=60.0)
        
        async with httpx.AsyncClient(timeout=timeout_config) as client:
            async with client.stream(
                "POST",
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            ) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    
                    # Skip SSE comments (OpenRouter keepalive)
                    if line.startswith(':'):
                        continue
                    
                    # Parse SSE data
                    if line.startswith('data: '):
                        data_str = line[6:]
                        
                        # Check for stream end
                        if data_str.strip() == '[DONE]':
                            break
                        
                        try:
                            data = json.loads(data_str)
                            delta = data.get('choices', [{}])[0].get('delta', {})
                            content = delta.get('content', '')
                            
                            if content:
                                full_content += content
                                await on_chunk(content)
                                
                        except json.JSONDecodeError:
                            # Ignore malformed chunks
                            pass
        
        logger.info(f"  ← {model} streamed ({len(full_content)} chars)")
        return {'content': full_content}
        
    except httpx.TimeoutException:
        logger.error(f"  ✗ {model} CONNECTION TIMEOUT (server unreachable)")
        return None
    except httpx.HTTPStatusError as e:
        logger.error(f"  ✗ {model} HTTP {e.response.status_code}: {e.response.text[:200]}")
        return None
    except Exception as e:
        logger.error(f"  ✗ {model} ERROR: {type(e).__name__}: {e}")
        return None


async def fetch_available_models() -> List[Dict[str, Any]]:
    """
    Fetch available models from OpenRouter API.

    Returns:
        List of model dicts with id, name, pricing, context_length, etc.
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers=headers
            )
            response.raise_for_status()
            data = response.json()
            return data.get('data', [])

    except Exception as e:
        print(f"Error fetching models from OpenRouter: {e}")
        return []
