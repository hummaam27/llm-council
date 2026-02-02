"""3-stage LLM Council orchestration."""

import asyncio
from typing import List, Dict, Any, Tuple, Callable, Optional
from .openrouter import query_model, stream_model, query_models_parallel
from . import config


async def stage1_collect_responses_streaming(
    user_query: str,
    on_chunk: Optional[Callable[[str, str], None]] = None,  # (model, chunk)
    on_model_complete: Optional[Callable[[str, bool], None]] = None,
    should_skip_model: Optional[Callable[[str], bool]] = None,  # Check if model should be skipped
    should_force_continue: Optional[Callable[[], bool]] = None,  # Check if we should stop early
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models with streaming.
    Supports skipping individual models and early termination.

    Args:
        user_query: The user's question
        on_chunk: Optional callback(model_name, text_chunk) called for each chunk
        on_model_complete: Optional callback(model_name, success) called when each model finishes
        should_skip_model: Optional callback(model_name) -> bool to check if model should be skipped
        should_force_continue: Optional callback() -> bool to check if we should stop waiting

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    messages = [{"role": "user", "content": user_query}]
    models = config.get_council_models()
    results_dict = {}  # model -> response
    
    async def stream_with_callback(model: str) -> tuple:
        """Stream a model and report progress. Checks for skip signal."""
        try:
            async def chunk_handler(chunk: str):
                # Check if this model was skipped
                if should_skip_model and should_skip_model(model):
                    raise asyncio.CancelledError("Model skipped by user")
                if on_chunk:
                    await on_chunk(model, chunk)
            
            result = await stream_model(model, messages, chunk_handler)
            if on_model_complete:
                await on_model_complete(model, result is not None)
            return (model, result)
        except asyncio.CancelledError:
            if on_model_complete:
                await on_model_complete(model, False)
            return (model, None)
        except Exception as e:
            if on_model_complete:
                await on_model_complete(model, False)
            return (model, None)
    
    # Create tasks with model tracking
    model_tasks = {model: asyncio.create_task(stream_with_callback(model)) for model in models}
    pending = set(model_tasks.values())
    
    # Wait for tasks, checking for force-continue signal
    while pending:
        # Check if we should force continue
        if should_force_continue and should_force_continue():
            # Cancel remaining tasks
            for task in pending:
                task.cancel()
            break
        
        # Wait for any task to complete (with short timeout to check signals)
        done, pending = await asyncio.wait(pending, timeout=0.5, return_when=asyncio.FIRST_COMPLETED)
        
        # Process completed tasks
        for task in done:
            try:
                model, response = task.result()
                if response is not None:
                    results_dict[model] = response
            except Exception:
                pass

    # Wait briefly for cancelled tasks to clean up
    if pending:
        await asyncio.sleep(0.1)
        for task in pending:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    # Format results
    stage1_results = []
    for model in models:
        if model in results_dict:
            stage1_results.append({
                "model": model,
                "response": results_dict[model].get('content', '')
            })

    return stage1_results


async def stage1_collect_responses(
    user_query: str,
    on_model_complete: Optional[Callable[[str, bool], None]] = None
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses (non-streaming fallback).
    """
    messages = [{"role": "user", "content": user_query}]
    models = config.get_council_models()
    
    async def query_with_callback(model: str) -> tuple:
        try:
            result = await asyncio.wait_for(
                query_model(model, messages, timeout=180.0),
                timeout=190.0
            )
            if on_model_complete:
                await on_model_complete(model, result is not None)
            return (model, result)
        except asyncio.TimeoutError:
            if on_model_complete:
                await on_model_complete(model, False)
            return (model, None)
        except Exception:
            if on_model_complete:
                await on_model_complete(model, False)
            return (model, None)
    
    tasks = [query_with_callback(model) for model in models]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    stage1_results = []
    for item in results:
        if isinstance(item, Exception):
            continue
        model, response = item
        if response is not None:
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


def _build_ranking_prompt(user_query: str, stage1_results: List[Dict[str, Any]]) -> Tuple[str, Dict[str, str]]:
    """
    Build the ranking prompt for Stage 2.
    
    Returns:
        Tuple of (prompt string, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    return ranking_prompt, label_to_model


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses (non-streaming).

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    ranking_prompt, label_to_model = _build_ranking_prompt(user_query, stage1_results)
    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    responses = await query_models_parallel(config.get_council_models(), messages)

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })

    return stage2_results, label_to_model


async def stage2_collect_rankings_streaming(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    on_chunk: Optional[Callable[[str, str], None]] = None,  # (model, chunk)
    on_model_complete: Optional[Callable[[str, bool], None]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses with streaming.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1
        on_chunk: Optional callback(model_name, text_chunk) called for each chunk
        on_model_complete: Optional callback(model_name, success) called when each model finishes

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    ranking_prompt, label_to_model = _build_ranking_prompt(user_query, stage1_results)
    messages = [{"role": "user", "content": ranking_prompt}]
    models = config.get_council_models()
    results_dict = {}  # model -> response content
    
    async def stream_with_callback(model: str) -> tuple:
        """Stream a model and report progress."""
        try:
            async def chunk_handler(chunk: str):
                if on_chunk:
                    await on_chunk(model, chunk)
            
            result = await stream_model(model, messages, chunk_handler)
            if on_model_complete:
                await on_model_complete(model, result is not None)
            return (model, result)
        except Exception as e:
            if on_model_complete:
                await on_model_complete(model, False)
            return (model, None)
    
    # Run all models in parallel with streaming
    tasks = [stream_with_callback(model) for model in models]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Process results
    for item in results:
        if isinstance(item, Exception):
            continue
        model, response = item
        if response is not None:
            results_dict[model] = response.get('content', '')
    
    # Format results
    stage2_results = []
    for model in models:
        if model in results_dict:
            full_text = results_dict[model]
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })

    return stage2_results, label_to_model


def _build_chairman_prompt(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]]
) -> str:
    """
    Build the chairman prompt for Stage 3.
    
    Returns:
        The prompt string
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    # Handle single response case - no peer rankings available
    if len(stage1_results) == 1:
        chairman_prompt = f"""You are the Chairman of an LLM Council. A single model has provided a response to the user's question.

Original Question: {user_query}

COUNCIL MEMBER RESPONSE:
{stage1_text}

Your task as Chairman is to review this response and provide a refined, comprehensive answer. Consider:
- The strengths and weaknesses of the provided response
- Any gaps or areas that could be improved
- Providing additional context or clarification where helpful

Provide a clear, well-reasoned final answer:"""
    else:
        # Multiple responses - include peer rankings
        stage2_text = "\n\n".join([
            f"Model: {result['model']}\nRanking: {result['ranking']}"
            for result in stage2_results
        ])

        chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    return chairman_prompt


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response (non-streaming).

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2 (may be empty if only 1 response)

    Returns:
        Dict with 'model' and 'response' keys
    """
    chairman_prompt = _build_chairman_prompt(user_query, stage1_results, stage2_results)
    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model
    chairman = config.get_chairman_model()
    response = await query_model(chairman, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": chairman,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": chairman,
        "response": response.get('content', '')
    }


async def stage3_synthesize_final_streaming(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    on_chunk: Optional[Callable[[str], None]] = None,  # (chunk)
    on_complete: Optional[Callable[[bool], None]] = None,
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response with streaming.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2 (may be empty if only 1 response)
        on_chunk: Optional callback(text_chunk) called for each chunk
        on_complete: Optional callback(success) called when complete

    Returns:
        Dict with 'model' and 'response' keys
    """
    chairman_prompt = _build_chairman_prompt(user_query, stage1_results, stage2_results)
    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model with streaming
    chairman = config.get_chairman_model()
    
    try:
        async def chunk_handler(chunk: str):
            if on_chunk:
                await on_chunk(chunk)
        
        response = await stream_model(chairman, messages, chunk_handler)
        
        if on_complete:
            await on_complete(response is not None)
        
        if response is None:
            return {
                "model": chairman,
                "response": "Error: Unable to generate final synthesis."
            }
        
        return {
            "model": chairman,
            "response": response.get('content', '')
        }
    except Exception as e:
        if on_complete:
            await on_complete(False)
        return {
            "model": chairman,
            "response": f"Error: {str(e)}"
        }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use gemini-2.5-flash for title generation (fast and cheap)
    response = await query_model("google/gemini-2.5-flash", messages)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(user_query: str) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
