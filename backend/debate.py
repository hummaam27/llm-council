"""Live debate system where LLMs discuss and respond to each other in real-time."""

from typing import List, Dict, Any, AsyncGenerator, Optional
import json
from .openrouter import query_model
from . import config

# Predefined adversarial roles to prevent echo chambers
DEBATE_ROLES = {
    "advocate": {
        "name": "The Advocate",
        "description": "You argue in favor of the proposition. Find the strongest arguments supporting it.",
        "style": "constructive and persuasive"
    },
    "skeptic": {
        "name": "The Skeptic", 
        "description": "You question assumptions and demand evidence. Challenge claims that lack support.",
        "style": "questioning and analytical"
    },
    "devils_advocate": {
        "name": "Devil's Advocate",
        "description": "You deliberately argue against the emerging consensus to stress-test ideas.",
        "style": "contrarian but constructive"
    },
    "synthesizer": {
        "name": "The Synthesizer",
        "description": "You find common ground and integrate different perspectives into coherent positions.",
        "style": "balanced and integrative"
    },
    "fact_checker": {
        "name": "The Fact-Checker",
        "description": "You focus on factual accuracy. Identify claims that may be incorrect or misleading.",
        "style": "precise and evidence-focused"
    },
    "pragmatist": {
        "name": "The Pragmatist",
        "description": "You focus on practical implications and real-world applicability of ideas.",
        "style": "practical and grounded"
    }
}

# Default role rotation for debates
DEFAULT_ROLE_ROTATION = ["advocate", "skeptic", "devils_advocate", "synthesizer"]


async def run_debate(
    topic: str,
    debate_models: List[str],
    moderator_model: str = None,
    max_turns: int = 12,
    attachments: List[Dict[str, Any]] = None,
    roles: Optional[List[str]] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run a live debate where models respond to each other.
    
    The moderator (chairman) controls:
    1. Who speaks next based on who has something valuable to add
    2. When the debate has reached a natural conclusion
    
    Args:
        topic: The debate topic
        debate_models: List of model IDs to participate
        moderator_model: Model to moderate (defaults to CHAIRMAN_MODEL)
        max_turns: Maximum discussion turns after opening statements
        attachments: Optional file attachments for context
        roles: Optional list of role keys (e.g., ['advocate', 'skeptic', 'devils_advocate'])
               If provided, assigns adversarial roles to prevent echo chambers.
               Available roles: advocate, skeptic, devils_advocate, synthesizer, fact_checker, pragmatist
    
    Yields events as the debate progresses for real-time streaming.
    """
    moderator = moderator_model or config.get_chairman_model()
    
    # Build context from attachments if any
    context = ""
    if attachments:
        for att in attachments:
            if att['type'] == 'pdf':
                context += f"\n\n--- Document: {att['name']} ---\n{att['text_content']}"
            elif att['type'] == 'image':
                context += f"\n\n[Image: {att['name']}]"
    
    # Initialize debate history
    debate_history: List[Dict[str, str]] = []
    
    # Assign friendly names and optional roles to models
    model_names = {}
    model_roles = {}  # Maps model_id to role dict
    
    for i, model_id in enumerate(debate_models):
        # Extract readable name from model ID
        name = model_id.split('/')[-1].split('-')[0].title()
        if name in model_names.values():
            name = f"{name}_{i+1}"
        model_names[model_id] = name
        
        # Assign role if roles are specified
        if roles and i < len(roles):
            role_key = roles[i]
            if role_key in DEBATE_ROLES:
                model_roles[model_id] = DEBATE_ROLES[role_key]
            else:
                model_roles[model_id] = None
        else:
            model_roles[model_id] = None
    
    # Yield debate start event with role information
    participants_info = []
    for m in debate_models:
        participant = {"id": m, "name": model_names[m]}
        if model_roles.get(m):
            participant["role"] = model_roles[m]["name"]
            participant["role_description"] = model_roles[m]["description"]
        participants_info.append(participant)
    
    yield {
        "type": "debate_start",
        "topic": topic,
        "participants": participants_info,
        "moderator": moderator,
        "role_based": bool(roles)
    }
    
    # Get opening statements from each participant
    yield {"type": "phase", "phase": "opening_statements"}
    
    for model_id in debate_models:
        role = model_roles.get(model_id)
        role_instruction = ""
        if role:
            role_instruction = f"""\n\nYOUR ASSIGNED ROLE: {role['name']}
Role Description: {role['description']}
Your debating style should be: {role['style']}

IMPORTANT: Stay true to your assigned role throughout the debate. Your role is designed to ensure rigorous examination of the topic from multiple angles."""
        
        opening_prompt = f"""You are participating in a panel discussion on the following topic:

TOPIC: {topic}
{context}{role_instruction}

You are {model_names[model_id]}. Give your opening perspective on this topic in 2-3 paragraphs.
Be thoughtful and present your view consistent with your role. Share your unique perspective.
Speak naturally as if in a live discussion."""

        yield {"type": "speaker_start", "model": model_id, "name": model_names[model_id]}
        
        response = await query_model(model_id, [{"role": "user", "content": opening_prompt}])
        content = response.get('content', 'Unable to respond.') if response else 'Unable to respond.'
        
        debate_history.append({
            "speaker": model_names[model_id],
            "model": model_id,
            "content": content,
            "type": "opening"
        })
        
        yield {
            "type": "speaker_complete",
            "model": model_id,
            "name": model_names[model_id],
            "content": content,
            "turn_type": "opening"
        }
    
    # Main debate loop - moderator selects speakers
    yield {"type": "phase", "phase": "discussion"}
    
    turn = 0
    while turn < max_turns:
        # Ask moderator who should speak next and if debate should continue
        history_text = "\n\n".join([
            f"**{h['speaker']}**: {h['content']}" for h in debate_history
        ])
        
        moderator_prompt = f"""You are moderating a panel discussion on: {topic}

Here is the discussion so far:
{history_text}

Participants available to speak: {', '.join(model_names.values())}

As moderator, decide:
1. Should the discussion continue, or has it reached a natural conclusion?
2. If continuing, who should speak next? Pick someone who likely has something valuable to add - perhaps they were referenced, have expertise to contribute, or might offer a different angle.

Respond in this exact JSON format:
{{"continue": true/false, "next_speaker": "speaker_name or null", "reason": "brief reason for your choice"}}

If the discussion has covered the topic well, key points have been made, and continuing would be repetitive, set continue to false."""

        mod_response = await query_model(moderator, [{"role": "user", "content": moderator_prompt}])
        mod_content = mod_response.get('content', '') if mod_response else ''
        
        # Parse moderator decision
        try:
            # Extract JSON from response
            import re
            json_match = re.search(r'\{[^}]+\}', mod_content)
            if json_match:
                decision = json.loads(json_match.group())
            else:
                decision = {"continue": True, "next_speaker": list(model_names.values())[turn % len(model_names)]}
        except:
            decision = {"continue": True, "next_speaker": list(model_names.values())[turn % len(model_names)]}
        
        yield {
            "type": "moderator_decision",
            "decision": decision
        }
        
        if not decision.get("continue", True):
            break
        
        # Find the model ID for the selected speaker
        next_speaker_name = decision.get("next_speaker")
        next_model = None
        for model_id, name in model_names.items():
            if name.lower() == str(next_speaker_name).lower():
                next_model = model_id
                break
        
        if not next_model:
            # Fallback to round-robin
            next_model = debate_models[turn % len(debate_models)]
        
        # Get the next speaker's response
        role = model_roles.get(next_model)
        role_instruction = ""
        if role:
            role_instruction = f"""\n\nRemember your role: {role['name']} - {role['description']}
Your style: {role['style']}
Stay true to your role while engaging with others."""
        
        speaker_prompt = f"""You are {model_names[next_model]} in a panel discussion on: {topic}
{context}

Here is the discussion so far:
{history_text}{role_instruction}

The moderator has called on you to speak. Respond to what's been said - you can:
- Build on someone's point
- Offer a different perspective
- Ask a clarifying question to another participant
- Synthesize ideas from multiple speakers
- Challenge assumptions if that fits your role

Be conversational and natural. Speak in 1-3 paragraphs. Don't repeat what's already been said.
If you agree with someone, say so briefly and add something new. Have your own voice."""

        yield {"type": "speaker_start", "model": next_model, "name": model_names[next_model]}
        
        response = await query_model(next_model, [{"role": "user", "content": speaker_prompt}])
        content = response.get('content', 'Unable to respond.') if response else 'Unable to respond.'
        
        debate_history.append({
            "speaker": model_names[next_model],
            "model": next_model,
            "content": content,
            "type": "discussion"
        })
        
        yield {
            "type": "speaker_complete",
            "model": next_model,
            "name": model_names[next_model],
            "content": content,
            "turn_type": "discussion"
        }
        
        turn += 1
    
    # Final summary from moderator
    yield {"type": "phase", "phase": "conclusion"}
    
    final_history = "\n\n".join([
        f"**{h['speaker']}**: {h['content']}" for h in debate_history
    ])
    
    summary_prompt = f"""You moderated a panel discussion on: {topic}

Here is the full discussion:
{final_history}

Provide a thoughtful summary that:
1. Captures the key points and perspectives shared
2. Notes areas of agreement and disagreement
3. Highlights any particularly insightful contributions
4. Offers a balanced conclusion or synthesis

Be fair to all participants and their viewpoints."""

    yield {"type": "summary_start"}
    
    summary_response = await query_model(moderator, [{"role": "user", "content": summary_prompt}])
    summary = summary_response.get('content', 'Unable to generate summary.') if summary_response else 'Unable to generate summary.'
    
    yield {
        "type": "summary_complete",
        "moderator": moderator,
        "summary": summary
    }
    
    yield {
        "type": "debate_complete",
        "total_turns": len(debate_history),
        "participants": list(model_names.values())
    }
