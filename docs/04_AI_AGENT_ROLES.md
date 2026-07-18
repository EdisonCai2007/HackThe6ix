# AI Agent Roles

## Meaning Of "Agents"

For MVP, "agents" does not need to mean a full agent framework. It can mean separate structured AI calls with different system prompts and responsibilities.

The generation system can use OpenRouter as a model adapter so the team can change models later without changing the architecture.

## Model Provider Assumption

Use an OpenRouter-compatible adapter for AI calls.

The docs should not lock the project to a single model. Candidate models can be chosen later based on:

- JSON reliability
- reasoning quality
- latency
- cost
- availability during the hackathon

## Agent 1: Prompt Interpreter

Purpose:

Convert an unrestricted user prompt into structured build intent.

Input:

- raw user prompt

Output:

- primary object
- style words
- key features
- preferred colors
- size hints
- whether prompt describes multiple objects

Rules:

- Do not reject imaginative prompts.
- If multiple objects are requested, choose one primary object for MVP.
- Preserve creative style as optional guidance.

Example:

```json
{
  "primary_object": "dragon",
  "style": "cyberpunk",
  "key_features": ["body", "head", "tail", "legs", "wings"],
  "preferred_colors": ["black", "green", "purple"],
  "size": "small",
  "multi_object_prompt": false
}
```

## Agent 2: Designer

Purpose:

Turn interpreted intent and inventory summary into a high-level LEGO build plan.

Input:

- interpreted prompt
- inventory summary
- piece cap
- supported part set

Output:

- target piece count
- prioritized object features
- rough dimensions
- feature-to-brick allocation plan

Rules:

- Prioritize physical buildability over visual detail.
- Prioritize silhouette and key features over color matching.
- Do not require unsupported parts.
- Keep output small.

## Agent 3: Builder Or Placement Proposer

Purpose:

Create candidate brick placements.

This may be either:

- an AI call that proposes structured placements, or
- algorithmic builder logic guided by the designer plan

For MVP reliability, this role should be constrained by explicit schema and part dimensions.

Rules:

- use only inventory parts
- assign every brick to a feature
- align to LEGO grid units
- keep one connected object
- avoid unsupported floating pieces

## Agent 4: Repair Agent

Purpose:

Fix invalid candidate models based on validator errors.

Input:

- previous candidate model
- validator errors
- remaining inventory
- original prompt intent

Output:

- revised candidate model

Rules:

- fix validation errors first
- preserve recognizable object features when possible
- do not add unsupported parts
- do not exceed the repair attempt limit

## Agent 5: Critic/Scorer

Purpose:

Evaluate a valid model for how well it matches the user's prompt.

The critic is optional for MVP. It is useful if there are multiple valid candidates.

Possible scoring output:

```json
{
  "recognizable_silhouette": 8,
  "key_features": 7,
  "color_match": 4,
  "build_compactness": 8,
  "overall": 7,
  "comments": [
    "Reads as a duck because it has a body, raised head, and orange beak.",
    "Eye details are missing but acceptable for the piece limit."
  ]
}
```

## Agent Loop Limit

The repair loop should be bounded.

Recommended MVP limit:

```text
initial generation + up to 2 repair attempts
```

If all attempts fail, the system should fall back to a smaller/simpler candidate rather than spin indefinitely.

