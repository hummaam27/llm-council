"""Sandbox simulation where LLM agents live in a 2D town and act each tick."""

from typing import List, Dict, Any, AsyncGenerator, Optional
import json
import re
from .openrouter import query_model
from .cost import extract_cost, warm_pricing_cache

# World dimensions and limits
GRID_SIZE = 25
AGENT_CAP = 6
MIN_AGENTS = 2
MAX_TICKS = 30
MEMORY_LIMIT = 12  # max remembered lines per agent
TALK_RANGE = 2     # Chebyshev distance within which agents can talk

# --- Scarcity / economy ---
STARTING_COINS = 5       # coins each agent begins with
WORK_PAYOUT = 4          # coins earned per `work` action
TREASURY_PER_AGENT = 14  # shared town treasury = this * agent count

# Cheap default keeps a full run affordable
DEFAULT_MODEL = "openai/gpt-4o-mini"

# Distinct sprite colors assigned by agent index
AGENT_COLORS = ["#e6550d", "#3182bd", "#31a354", "#756bb1", "#d6616b", "#e7ba52"]

# Places in town. Each is a rectangle PLUS a vibe and a set of activities —
# the place is injected into an agent's prompt so it shapes behavior.
PLACES = {
    "market": {
        "x": 1, "y": 3, "w": 7, "h": 6, "label": "The Market",
        "vibe": "stalls and crates, the clatter of coin and bargaining — the "
                "one place in town where a living can be earned",
        "activities": ["work for coins", "haggle over a price",
                        "hawk your wares", "size up a rival", "strike a deal"],
    },
    "town_hall": {
        "x": 9, "y": 3, "w": 7, "h": 6, "label": "The Town Hall",
        "vibe": "a high-ceilinged chamber of records and rulings, where the "
                "town's decisions are argued over and made",
        "activities": ["propose a rule", "campaign for support",
                        "claim a title or office", "broker an alliance",
                        "hold forth on how the town should be run"],
    },
    "temple": {
        "x": 17, "y": 3, "w": 7, "h": 6, "label": "The Temple",
        "vibe": "still air and candlelight, a hush that makes people speak of "
                "meaning, faith, and right and wrong",
        "activities": ["preach what you believe", "found or grow a movement",
                        "seek meaning", "ask others for offerings",
                        "pass moral judgement"],
    },
    "backstreet": {
        "x": 1, "y": 10, "w": 7, "h": 6, "label": "The Backstreet",
        "vibe": "a narrow lane the town watch never walks, where deals are "
                "struck out of sight",
        "activities": ["make a shady deal", "scheme", "trade in secret",
                        "talk where no one overhears", "look for an angle"],
    },
    "commons": {
        "x": 9, "y": 10, "w": 7, "h": 6, "label": "The Commons",
        "vibe": "the open crossroads at the heart of town, where every path "
                "meets and everyone passes through",
        "activities": ["rest at the crossroads", "watch who passes",
                        "wait to meet someone", "take the town's pulse"],
    },
    "archive": {
        "x": 17, "y": 10, "w": 7, "h": 6, "label": "The Archive",
        "vibe": "towering shelves of books and old records, dust and quiet — "
                "the town's whole memory",
        "activities": ["study", "dig up a useful fact",
                        "uncover an old secret", "learn what others don't",
                        "record something"],
    },
    "tavern": {
        "x": 9, "y": 18, "w": 7, "h": 6, "label": "The Tavern",
        "vibe": "low light, loud tables, spilled ale and louder gossip — "
                "tongues loosen here",
        "activities": ["trade gossip", "forge a quiet pact",
                        "spread a rumour", "loosen someone's tongue",
                        "drink and listen"],
    },
}


def _place_at(x: int, y: int) -> Optional[Dict[str, Any]]:
    """Return the place dict containing (x, y), or None if on open ground."""
    for p in PLACES.values():
        if p["x"] <= x < p["x"] + p["w"] and p["y"] <= y < p["y"] + p["h"]:
            return p
    return None


def _place_label(x: int, y: int) -> Optional[str]:
    p = _place_at(x, y)
    return p["label"] if p else None


def _place_center(p: Dict[str, Any]) -> tuple:
    return (p["x"] + p["w"] // 2, p["y"] + p["h"] // 2)


def _resolve_place(text: str) -> Optional[Dict[str, Any]]:
    """Match a free-text destination to a place (by key or label)."""
    t = (text or "").strip().lower()
    if not t:
        return None
    if t in PLACES:
        return PLACES[t]
    for p in PLACES.values():
        lbl = p["label"].lower()
        if t == lbl or t in lbl or lbl.replace("the ", "") in t:
            return p
    return None


def _free_tile_in(place, agents, mover_id, near_agent=None) -> tuple:
    """Pick a free tile inside a place — adjacent to near_agent if given."""
    occupied = {(a["x"], a["y"]) for a in agents if a["id"] != mover_id}
    tiles = [
        (x, y)
        for x in range(place["x"], place["x"] + place["w"])
        for y in range(place["y"], place["y"] + place["h"])
    ]
    if near_agent:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                t = (near_agent["x"] + dx, near_agent["y"] + dy)
                if (dx, dy) != (0, 0) and t in tiles and t not in occupied:
                    return t
    center = _place_center(place)
    if center not in occupied:
        return center
    for t in tiles:
        if t not in occupied:
            return t
    return center


def _starting_positions(n: int) -> List[tuple]:
    """Assign distinct starting tiles, one per place, spread around town."""
    centers = [_place_center(p) for p in PLACES.values()]
    positions = []
    for i in range(n):
        cx, cy = centers[i % len(centers)]
        ring = i // len(centers)
        x = max(0, min(GRID_SIZE - 1, cx + ring))
        y = max(0, min(GRID_SIZE - 1, cy + ring))
        while (x, y) in positions:
            x = max(0, min(GRID_SIZE - 1, x + 1))
        positions.append((x, y))
    return positions


def _nearby_agents(agent, agents):
    """Other agents within TALK_RANGE (Chebyshev distance)."""
    near = []
    for other in agents:
        if other["id"] == agent["id"]:
            continue
        if max(abs(other["x"] - agent["x"]), abs(other["y"] - agent["y"])) <= TALK_RANGE:
            near.append(other)
    return near


def _relative_dir(fx: int, fy: int, tx: int, ty: int) -> str:
    """Human-readable compass direction from (fx,fy) to (tx,ty)."""
    dx, dy = tx - fx, ty - fy
    parts = []
    if dy < 0:
        parts.append("north")
    elif dy > 0:
        parts.append("south")
    if dx < 0:
        parts.append("west")
    elif dx > 0:
        parts.append("east")
    return "-".join(parts) if parts else "right here"


def _build_perception(agent, agents, treasury):
    """Text block describing what the agent currently sees, where, and remembers."""
    ax, ay = agent["x"], agent["y"]
    place = _place_at(ax, ay)
    lines = []

    if place:
        lines.append(
            f"You are at {place['label']} — {place['vibe']}. "
            f"Here, people: {', '.join(place['activities'])}."
        )
    else:
        lines.append("You are out and about in town.")

    lines.append(
        "Places you can travel to in one step: "
        + ", ".join(p["label"] for p in PLACES.values()) + "."
    )

    # Economy — the scarce resource everyone can see.
    others_coins = ", ".join(
        f"{o['name']} {o['coins']}" for o in agents if o["id"] != agent["id"]
    )
    lines.append(
        f"ECONOMY — You have {agent['coins']} coins. The town treasury holds "
        f"{treasury} coins (shared; it depletes as people work it and never "
        f"refills). Coins are earned only by working at the Market. "
        f"Everyone's coins: you {agent['coins']}"
        + (f", {others_coins}" if others_coins else "") + "."
    )

    near = _nearby_agents(agent, agents)
    near_ids = {o["id"] for o in near}
    if near:
        for o in near:
            extra = f" ({o['activity']})" if o.get("activity") else ""
            lines.append(
                f"Within talking distance: {o['name']} is to your "
                f"{_relative_dir(ax, ay, o['x'], o['y'])}{extra}."
            )
    else:
        lines.append("There is no one within talking distance right now.")

    distant = [o for o in agents if o["id"] != agent["id"] and o["id"] not in near_ids]
    if distant:
        lines.append("Other people in town:")
        for o in distant:
            where = _place_label(o["x"], o["y"]) or "out and about"
            doing = f", {o['activity']}" if o.get("activity") else ""
            lines.append(f"  - {o['name']} is at {where}{doing}.")

    if agent["memory"]:
        lines.append("Recent memory:")
        lines.extend(f"  - {m}" for m in agent["memory"][-MEMORY_LIMIT:])

    return "\n".join(lines)


def _decide_prompt(agent, perception):
    """The single-message prompt asking an agent to choose one action."""
    return f"""You are {agent['name']}, a character living in a small town.
BACKSTORY: {agent['backstory'] or '(none given)'}
PERSONALITY: {agent['personality'] or '(none given)'}
GOAL: {agent['goal'] or '(none given)'}

The town has these places: {', '.join(p['label'] for p in PLACES.values())}.

CURRENT SITUATION:
{perception}

Decide ONE action for this turn. Pursue your GOAL above all — let it drive
every choice. You are a real person with wants, not a friendly chatbot.

Weigh these honestly against your goal:
- Coins are SCARCE. The town treasury is the only source of new coins and it
  is steadily draining as people work it — once it hits zero, no one can ever
  earn again. You can only "work" while you are AT THE MARKET; if your goal
  needs coins, get to the Market and work NOW. Others compete for the pool.
- "give" coins to someone — to win an ally, seal a bargain, or out of kindness.
- "talk" to people to befriend, persuade, bargain with, or outmanoeuvre them —
  not just to be pleasant. Endless small-talk serves no goal.
- "go" to a place that fits your goal; "act" to do what that place is for.
- Every turn should move you toward your goal. Don't "observe" twice in a row.

Respond with ONLY a JSON object, no other text, in one of these forms:
{{"action":"go","destination":"<a place name from the list>","thought":"why"}}
{{"action":"talk","target":"<nearby character name>","message":"what you say","thought":"why"}}
{{"action":"act","activity":"<something people do at this place>","thought":"why"}}
{{"action":"work","thought":"why you earn coins now"}}
{{"action":"give","target":"<character name>","amount":<number>,"thought":"why"}}
{{"action":"think","thought":"a private reflection"}}
{{"action":"observe","thought":"what you notice"}}"""


def _parse_action(raw):
    """Extract the action JSON from a model response, defaulting to observe."""
    if not raw:
        return {"action": "observe", "thought": ""}
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return {"action": "observe", "thought": raw.strip()[:200]}
    try:
        parsed = json.loads(match.group())
        if not isinstance(parsed, dict) or "action" not in parsed:
            return {"action": "observe", "thought": ""}
        return parsed
    except (json.JSONDecodeError, ValueError):
        return {"action": "observe", "thought": ""}


async def run_simulation(
    agents_spec: List[Dict[str, Any]],
    max_ticks: int = 15,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Run a tick-based sandbox simulation, yielding events for real-time streaming.

    Each tick, every agent perceives its surroundings (the place it is at, who
    is around) and chooses one action: go (travel straight to a place), talk,
    act, think or observe. The place context shapes behavior and conversation.
    """
    agents: List[Dict[str, Any]] = []
    used_names = set()
    positions = _starting_positions(len(agents_spec))

    for i, spec in enumerate(agents_spec):
        name = (spec.get("name") or f"Agent {i + 1}").strip()
        if name in used_names:
            name = f"{name}_{i + 1}"
        used_names.add(name)
        x, y = positions[i]
        agents.append({
            "id": f"agent-{i}",
            "name": name,
            "backstory": spec.get("backstory", ""),
            "personality": spec.get("personality", ""),
            "goal": spec.get("goal", ""),
            "model": spec.get("model") or DEFAULT_MODEL,
            "x": x, "y": y,
            "color": AGENT_COLORS[i % len(AGENT_COLORS)],
            "activity": None,
            "coins": STARTING_COINS,
            "memory": [f"You started the day at {_place_label(x, y) or 'the edge of town'}."],
        })

    name_to_agent = {a["name"].lower(): a for a in agents}

    # Shared, depleting town treasury — the scarce resource.
    treasury = TREASURY_PER_AGENT * len(agents)

    await warm_pricing_cache()
    total_cost = 0.0

    yield {
        "type": "sim_start",
        "grid_size": GRID_SIZE,
        "starting_treasury": treasury,
        "places": [
            {"key": k, "label": p["label"], "x": p["x"], "y": p["y"],
             "w": p["w"], "h": p["h"]}
            for k, p in PLACES.items()
        ],
        "agents": [
            {"id": a["id"], "name": a["name"], "model": a["model"],
             "x": a["x"], "y": a["y"], "color": a["color"]}
            for a in agents
        ],
        "max_ticks": max_ticks,
    }

    for tick in range(max_ticks):
        yield {"type": "tick_start", "tick": tick}

        for agent in agents:
            perception = _build_perception(agent, agents, treasury)
            prompt = _decide_prompt(agent, perception)
            response = await query_model(
                agent["model"], [{"role": "user", "content": prompt}]
            )
            raw = response.get("content", "") if response else ""
            call_cost = extract_cost(response, agent["model"])["cost"]
            total_cost += call_cost
            action = _parse_action(raw)
            kind = action.get("action", "observe")
            thought = str(action.get("thought", ""))[:400]

            dialogue = None
            target_id = None
            target_name = None
            give_amount = None

            if kind in ("go", "move", "travel"):
                dest = _resolve_place(
                    action.get("destination") or action.get("place") or ""
                )
                cur = _place_at(agent["x"], agent["y"])
                if dest is not None and dest is not cur:
                    others = [
                        o for o in agents
                        if o["id"] != agent["id"]
                        and _place_at(o["x"], o["y"]) is dest
                    ]
                    nx, ny = _free_tile_in(
                        dest, agents, agent["id"], others[0] if others else None
                    )
                    agent["x"], agent["y"] = nx, ny
                    agent["activity"] = None
                    agent["memory"].append(f"You travelled to {dest['label']}.")
                    kind = "move"
                else:
                    # nowhere new to go — treat as a quiet beat
                    kind = "observe"
                    if thought:
                        agent["memory"].append(f"You thought: {thought}")

            elif kind == "talk":
                target = name_to_agent.get(str(action.get("target", "")).lower())
                near_ids = {o["id"] for o in _nearby_agents(agent, agents)}
                message = str(action.get("message", "")).strip()
                if target and target["id"] in near_ids and message:
                    dialogue = message
                    target_id = target["id"]
                    target_name = target["name"]
                    agent["memory"].append(f'You said to {target_name}: "{message}"')
                    target["memory"].append(f'{agent["name"]} said to you: "{message}"')
                else:
                    kind = "observe"
                    if thought:
                        agent["memory"].append(f"You thought: {thought}")

            elif kind == "act":
                activity = str(action.get("activity", "")).strip()[:120]
                if activity:
                    agent["activity"] = activity
                    where = _place_label(agent["x"], agent["y"]) or "around town"
                    agent["memory"].append(f"You {activity} at {where}.")
                else:
                    kind = "observe"
                    if thought:
                        agent["memory"].append(f"You thought: {thought}")

            elif kind == "work":
                at_market = _place_at(agent["x"], agent["y"]) is PLACES["market"]
                if not at_market:
                    # Work only pays at the Market — the economic chokepoint.
                    kind = "observe"
                    agent["memory"].append(
                        "You looked for work, but coin is only earned at "
                        "the Market — you must be there."
                    )
                else:
                    gained = min(WORK_PAYOUT, treasury)
                    treasury -= gained
                    agent["coins"] += gained
                    if gained > 0:
                        agent["memory"].append(
                            f"You worked at the Market and earned {gained} "
                            f"coins (treasury now {treasury})."
                        )
                    else:
                        agent["memory"].append(
                            "You tried to work but the treasury was empty."
                        )

            elif kind == "give":
                target = name_to_agent.get(str(action.get("target", "")).lower())
                try:
                    requested = int(action.get("amount", 0))
                except (TypeError, ValueError):
                    requested = 0
                amount = max(0, min(requested, agent["coins"]))
                if target and target["id"] != agent["id"] and amount > 0:
                    agent["coins"] -= amount
                    target["coins"] += amount
                    target_id = target["id"]
                    target_name = target["name"]
                    give_amount = amount
                    agent["memory"].append(
                        f"You gave {amount} coins to {target_name}."
                    )
                    target["memory"].append(
                        f"{agent['name']} gave you {amount} coins."
                    )
                else:
                    kind = "observe"
                    if thought:
                        agent["memory"].append(f"You thought: {thought}")

            else:  # think or observe
                kind = "think" if kind == "think" else "observe"
                if thought:
                    agent["memory"].append(f"You thought: {thought}")

            for a in agents:
                if len(a["memory"]) > MEMORY_LIMIT:
                    a["memory"] = a["memory"][-MEMORY_LIMIT:]

            yield {
                "type": "agent_action",
                "tick": tick,
                "agent_id": agent["id"],
                "name": agent["name"],
                "action": kind,
                "x": agent["x"],
                "y": agent["y"],
                "place": _place_label(agent["x"], agent["y"]),
                "activity": agent["activity"],
                "thought": thought,
                "dialogue": dialogue,
                "target_id": target_id,
                "target_name": target_name,
                "amount": give_amount,
                "coins": agent["coins"],
                "treasury": treasury,
                "cost": call_cost,
                "total_cost": total_cost,
            }

        yield {"type": "tick_complete", "tick": tick}

    standings = sorted(
        ({"id": a["id"], "name": a["name"], "coins": a["coins"]} for a in agents),
        key=lambda a: a["coins"], reverse=True,
    )

    yield {
        "type": "sim_complete",
        "total_ticks": max_ticks,
        "agents": [
            {"id": a["id"], "name": a["name"], "x": a["x"], "y": a["y"]}
            for a in agents
        ],
        "treasury": treasury,
        "standings": standings,
        "total_cost": total_cost,
    }
