# Drop-in prompt for ChatGPT Deep Research: LEGO generation quality ceiling

Copy everything below the divider into a fresh ChatGPT Deep Research conversation.

---

I want you to conduct a rigorous, evidence-backed technical investigation into why an AI system that generates LEGO-style builds from a fixed inventory has hit a quality ceiling, and what we should change next.

This is not a request for generic brainstorming or a list of prompt-writing tips. Treat it as an architecture, model-behavior, representation, search, evaluation, and product-pipeline investigation. Use current web research. Prefer primary sources: peer-reviewed papers, authors' project pages, official technical documentation, credible open-source repositories, and first-party platform documentation. Cite claims close to the text that they support and distinguish published evidence from your own inference.

You do not have access to our repository. The verified project snapshot below is intended to make this prompt self-contained. Do not wait for repository access before beginning. If an important conclusion cannot be established from this snapshot and external research, identify the missing measurement and propose the smallest experiment needed to obtain it.

## Product objective

The product lets a user build a LEGO-style model from a known inventory in either of two ways:

1. **Inventory-driven suggestion:** the system examines the user's available inventory, suggests good things that could be built from it, and the user selects a suggestion.
2. **Direct user request:** the user describes what they want to build.

In both cases, the system should produce a recognizable, attractive, creative, physically coherent model that uses only pieces in the supplied inventory. The result is rendered in a Three.js editor and can be exported to LDraw.

The current system is often technically valid but visually and conceptually mediocre. We appear to have hit a quality ceiling.

## The two problems to investigate

### Problem A: inventory-driven suggestions are a missed opportunity

The suggestion feature should synthesize the inventory and brainstorm the **best-looking and most creative build that this particular inventory can support**. This should be the easier case for the system: unlike a user request, the system controls the choice of object and can select an idea that fits its materials and capabilities.

Instead, suggestions are often repetitive, ordinary, or poorly grounded in the available shapes. More importantly, the build produced after a suggestion is selected often fails to realize the qualities or features that made the suggestion sound appealing. The idea generator and the builder appear insufficiently coupled.

Research why this supposedly favorable setup still produces low-quality designs. Investigate both the quality of the ideas and the failure to translate a chosen idea into a matching build.

### Problem B: direct user requests produce inadequate builds

When the user directly specifies an object, results are sometimes recognizable and somewhat acceptable, but remain inadequate for our quality bar. They tend to be simplistic, poorly proportioned, weakly detailed, or only nominally related to requested features.

Do **not** accept “the catalog has only 17 shapes” as the default explanation. These are 17 genuinely different rectangular brick and plate types, with multiple lengths, widths, and heights. That is a constraint, but it should still permit significantly stronger composition, silhouette, proportion, color blocking, symmetry, feature placement, and part usage than we are observing. Determine how much of the ceiling is truly caused by shape expressivity and how much is caused by planning, representation, model capability, prompting, search, orchestration, validation, or the absence of a visual-quality feedback loop.

## Verified current system

### Technology and output representation

- Node.js application using ES modules.
- Three.js preview/editor and deterministic LDraw export.
- Internal coordinates use `x` and `y` in stud units and `z` in plate layers.
- Plates have a height of 1 layer; bricks have a height of 3 layers.
- Rotations are restricted to 0, 90, 180, or 270 degrees.
- A generated result is structured JSON containing model name, original prompt, piece count, dimensions, inventory ID, generator version, and an array of bricks. Each brick includes an ID, supported part identifier, LDraw filename, label, color, position, rotation, semantic feature, and instruction step.
- A hard cap of 100 pieces is currently enforced.

### Supported shape catalog

The catalog contains 17 axis-aligned rectangular shapes:

**Bricks:**

- 1x1 brick (`3005`)
- 1x2 brick (`3004`)
- 1x3 brick (`3622`)
- 1x4 brick (`3010`)
- 1x6 brick (`3009`)
- 1x8 brick (`3008`)
- 2x2 brick (`3003`)
- 2x3 brick (`3002`)
- 2x4 brick (`3001`)

**Plates:**

- 1x2 plate (`3023`)
- 1x4 plate (`3710`)
- 1x6 plate (`3666`)
- 2x2 plate (`3022`)
- 2x4 plate (`3020`)
- 4x4 plate (`3031`)
- 4x6 plate (`3032`)
- 4x8 plate (`3035`)

One current example inventory used by the suggestion flow contains 85 total pieces across 21 part/color combinations and 9 colors: red, black, white, brown, yellow, dark bluish gray, green, translucent light blue, and orange.

### Current AI provider and models

- All current generation requests go through Backboard, using Google-hosted model IDs.
- Suggestion model: `gemini-3.1-flash-lite`
- Structure-planning model: `gemini-3.1-flash-lite`
- Exact-placement model: `gemini-3.5-flash`
- Repair model: `gemini-3.5-flash`
- Backboard memory is disabled.
- No persistent Backboard assistant ID is configured; calls are effectively isolated.

Model names and provider availability may change over time. Research current relevant capabilities, but frame conclusions in terms of capability classes and measured behavior rather than assuming that swapping a model alone fixes the architecture.

### Inventory-driven suggestion flow

The system sends an inventory summary to the suggestion model and asks for up to five objects. Each suggestion has:

- a short display label;
- `prompt_metadata`, which describes recognizable features, silhouette, and colors;
- `inventory_reasoning`, which explains why the inventory supports the idea.

The current suggestion prompt favors realistic everyday objects and discourages generic blocks, towers, and speculative high-tech objects. However, it also instructs `prompt_metadata` to avoid size adjectives and not mention specific parts, part IDs, dimensions, piece counts, or construction instructions.

When a user clicks a suggestion, **only `prompt_metadata` is copied into the normal build prompt**. The inventory reasoning is discarded. No candidate geometry, canonical design brief, feature map, feasibility analysis, part allocation, or construction plan is carried forward. The downstream structure and placement stages start over from the selected text plus the inventory.

Suggestions are returned in one pass. There is no explicit best-of-N search, diversity penalty, feasibility score, visual-quality score, novelty comparison, candidate sketch, provisional build, or validator-informed ranking before suggestions are shown.

### Direct and suggestion-selected generation flow

Both paths converge on the same pipeline:

1. **Structure planning.** The model emits high-level JSON with a primary object, target piece count, overall shape, required features, part-usage plan, build strategy, fallback priorities, and summary. It does not emit coordinates, a mesh, or an occupancy representation. The prompt generally encourages one connected object and often prefers 10–40 pieces, with an absolute limit of 100.
2. **Exact placement.** A second model receives the user prompt, inventory, and structure plan, then directly emits every brick and exact integer coordinate in the final model JSON. Only one initial candidate is generated.
3. **Parsing and schema checks.** Malformed JSON may receive one repair attempt.
4. **Deterministic validation and cleanup.** Inventory and geometric constraints are checked. Unsupported or overused parts can be cleaned up deterministically.
5. **AI repair.** If the remaining validation errors are considered repairable, a repair model can rewrite the build.
6. **Final validation and fallback.** The result is validated again, with a pruned fallback available in some cases.

The exact-placement model is therefore being asked to solve semantic interpretation, spatial composition, discrete packing, inventory allocation, structural connectivity, feature realization, and serialization through raw coordinate generation in a single response.

### Backboard integration details relevant to the investigation

- The original Gemini-oriented request is translated into a Backboard message.
- A response schema is embedded as text in the prompt instead of being enforced through a provider-native structured-output schema.
- The full inventory is removed from the ordinary user payload and replaced by an inventory ID plus a retrieval instruction.
- Backboard tools expose inventory summarization and deterministic model validation.
- The system instructs the model to retrieve inventory before relying on counts and to validate placement output before finalizing.
- Tool-action rounds are supported, but current logs do not capture the intermediate Backboard tool-call transcript. We therefore cannot yet confirm how reliably the model retrieves the inventory, invokes validation, understands tool results, or modifies its answer after validation.

Investigate whether this translation/tool layer could reduce grounding, schema adherence, or spatial performance, and specify how to measure it. Do not assume it is the cause without evidence.

### What deterministic validation currently guarantees

The validator checks:

- every part is supported by the catalog;
- the inventory contains each requested part/color and counts are not exceeded;
- coordinates align to the grid;
- rotations are legal quarter turns;
- no occupied cells overlap;
- each non-ground brick has stud-area support immediately below it;
- the build is vertically connected as one component;
- the model contacts the ground;
- the piece cap is respected.

It does **not** measure:

- resemblance to the requested object;
- semantic feature fidelity;
- visual appeal or craftsmanship;
- creativity or novelty;
- proportion and silhouette quality;
- symmetry or intentional asymmetry;
- color composition;
- detail placement;
- efficient or expressive use of the inventory;
- whether the result matches the original suggestion;
- instruction quality;
- whether a human would choose, keep, edit, or rebuild the result.

This means that “valid” currently means legal and connected, not good.

## Observed runtime evidence

Treat the following as a small, non-random diagnostic sample, not a formal benchmark.

- The automated suite currently has 159 passing tests. These verify contracts, orchestration, parsing, deterministic constraints, LDraw conversion, and editor behavior—not aesthetic or semantic output quality.
- In recent parseable first-pass placement outputs for which the inventory could be reconstructed, 6 of 7 passed the deterministic validator. The remaining result had a disconnected component.
- These valid outputs included builds such as fire hydrants, park benches, a drone, and a two-piece tower. Average usage was about 19 pieces.
- The fact that most passed deterministic validation while users remained dissatisfied strongly suggests that legality is not a useful proxy for design quality.
- Recent examples included park benches with only 10 and 15 pieces, and fire hydrants with 22 and 28 pieces. Some outputs are essentially stacked rectangular masses with weak feature expression.
- Suggestion results repeatedly converge on objects such as mailboxes, fire hydrants, coffee mugs, park benches, toolboxes, stop signs, crates, and pedestals.
- Suggestions sometimes describe capabilities absent from the catalog, including hinged flags, rounded tops, curved handles, wheels, a dedicated windshield piece, octagonal signs, domed caps, and cylindrical bodies. Some of these forms can be approximated using rectangular pieces, but the reasoning often speaks as though a matching specialty element exists.
- Across a recent log sample, suggestion calls were more frequent than structure or placement calls, yet repeated suggestions remained common. There is no tracked history or diversity pressure across refreshes.
- Exact placement is much slower and more token-intensive than suggestion or structure planning, but currently produces only one candidate before repair.
- Runtime logs record AI request/response data, stage, model, duration, and some token metadata. They do not currently record a complete end-to-end outcome containing selected suggestion, final validation, intermediate tool trace, rendered quality, human rating, user acceptance, manual edits, or abandonment.

## Important disparity to analyze

There are three different objectives, but the current pipeline only directly optimizes one of them:

1. **Legality:** deterministic constraints—currently measured.
2. **Semantic fidelity:** whether the build depicts the requested or suggested object and includes its defining features—described in prompts, but not independently scored.
3. **Design quality:** attractiveness, creativity, proportions, composition, detail, and skillful inventory use—not measured.

The suggestion flow introduces a fourth objective—**choose the best build opportunity for this inventory**—but never generates or evaluates a build before presenting the idea.

## Research mandate

Determine the most likely causes of the quality ceiling and propose an evidence-backed improvement program. Analyze the entire system rather than assuming the answer is prompt tuning.

At minimum, investigate these possible bottlenecks:

1. **Model capability and allocation:** whether the current suggestion, planning, placement, and repair models have adequate spatial reasoning, long structured-output reliability, instruction following, and visual reasoning; whether different stages need different model classes.
2. **Prompt and context design:** underspecified quality criteria, conflicts in the suggestion prompt, weak examples, missing negative examples, excessive or insufficient constraints, poor feature prioritization, and loss of suggestion reasoning.
3. **Suggestion-to-build continuity:** whether the suggestion stage should produce a persistent design brief, feature anchors, part budget, layer plan, provisional geometry, thumbnail, or multiple validated sketches rather than disposable prose.
4. **Representation:** whether high-level prose followed by raw brick coordinates is an unsuitable intermediate representation. Compare alternatives such as layered occupancy maps, voxel or stud grids, semantic part graphs, feature-anchor graphs, subassemblies, symmetry constraints, shape grammars, procedural programs, or hybrid representations.
5. **Search and candidate selection:** the absence of best-of-N generation, beam search, tree search, self-consistency, iterative refinement, constraint-solving, or learned/rule-based reranking.
6. **Deterministic construction:** whether an algorithmic builder should convert an AI-authored semantic plan into legal placements using CSP, SAT, ILP, graph search, packing, procedural grammars, or another method, instead of asking an LLM to emit all coordinates directly.
7. **Critique and visual feedback:** whether candidates should be rendered from multiple views and scored or critiqued by a vision-language model, image-text similarity system, geometric metrics, or human preference model before selection.
8. **Quality evaluator design:** how to measure semantic fidelity, visual appeal, creativity, diversity, proportionality, silhouette, color use, inventory use, stability, edit burden, and user preference without allowing the evaluator to reward superficial prompt compliance.
9. **Repair objective:** the current repair loop mainly reacts to deterministic invalidity. Investigate semantic and aesthetic repair, feature-level critique, local edits versus full regeneration, and how to prevent regressions in already-correct regions.
10. **Inventory expressivity:** quantify or experimentally isolate the real effect of the 17-shape rectangular catalog. Compare what strong procedural/manual/deterministic reference builds can achieve with the same parts against AI results. Identify which additional shape categories would create the highest marginal quality gain, but do not use catalog expansion as a substitute for improving composition with existing pieces.
11. **Provider/orchestration layer:** Backboard schema handling, inventory retrieval, tool-call reliability, disabled memory, isolated calls, and missing tool traces. Determine what should be instrumented or A/B tested.
12. **Data and examples:** whether curated exemplars, retrieval of similar builds, LDraw datasets, procedural synthetic data, preference data, or fine-tuning would help; include licensing, data-quality, leakage, and conversion concerns.
13. **Product constraints:** latency, token cost, reliability, explainability, user wait time, and the tradeoff between interactive generation and offline search.

Research relevant work in LLM-guided program synthesis, verifier-guided generation, constrained decoding, discrete spatial reasoning, LEGO or brick assembly generation, voxel/block construction, shape abstraction, procedural modeling, inverse graphics, multimodal critique, best-of-N inference, test-time compute, planning/execution separation, and human-preference evaluation. Include useful lessons from adjacent systems even if no directly comparable LEGO product publishes its architecture.

## Questions the report must answer

1. What are the five most likely root causes of our current quality ceiling, ranked by confidence and expected impact?
2. Which observations are confirmed facts, which are plausible inferences, and which require experiments?
3. Why does the inventory-driven suggestion case fail despite allowing the system to choose an easy, suitable object?
4. Why does the selected build drift from or under-realize its suggestion?
5. Is raw one-shot coordinate generation a fundamental architectural bottleneck? What evidence supports or challenges that conclusion?
6. Which improvements can realistically be obtained through prompt changes, stronger models, native structured outputs, better tool use, examples, and reranking without rebuilding the system?
7. Which improvements require a new intermediate representation, deterministic builder, search loop, visual critic, or evaluator?
8. How should suggestion generation search for and rank ideas based on both creativity and expected build quality—not merely linguistic appeal?
9. What is the best way to carry a suggestion's intent into construction so the final model is accountable to the selected concept?
10. How should the system evaluate direct user requests when exact resemblance may be impossible, while still demanding a strong approximation?
11. How can we determine whether 17 shapes are actually limiting quality? Design a controlled test rather than answering from intuition.
12. What telemetry and evaluation data must be added before additional tuning can be trusted?
13. What should we do in the next 48 hours, the next 1–2 weeks, and in a longer architecture redesign?
14. What should we explicitly avoid because it is likely to consume time or tokens without producing a durable quality improvement?

## Required deliverables

Produce a report with the following sections.

### 1. Executive diagnosis

Give a concise explanation of why legal builds can remain bad designs. State the most likely bottleneck or combination of bottlenecks, the strongest supporting evidence, and the highest-leverage next move.

### 2. Current-system failure map

Map both user flows from input to suggestion/planning/placement/validation/rendering. Identify where information is created, lost, weakly represented, or never evaluated. Clearly separate Problem A from Problem B, then show their shared causes.

### 3. Root-cause matrix

For each suspected cause, include:

- observed evidence from the project snapshot;
- supporting or contradicting external evidence;
- confidence level;
- likely impact on Problem A, Problem B, or both;
- smallest discriminating experiment;
- what result would confirm or weaken the hypothesis.

### 4. Research synthesis

Summarize the most applicable findings from research and real systems. Do not merely list sources. Explain what transfers to this constrained brick-generation problem, what does not, and why.

### 5. Near-term improvement plan

Recommend changes possible without a ground-up rewrite. Cover prompt/model tuning, model allocation, suggestion diversity and feasibility, continuity of the design brief, native structured output if available, candidate generation/reranking, tool-call instrumentation, and evaluation. Include concrete prompt/schema changes where useful.

Do not present prompt tuning as a complete solution. For each recommendation, state the expected signal, likely ceiling, latency/token implications, and rollback criterion.

### 6. Longer-term architecture options

Compare at least three credible architectures, including:

- an improved all-LLM pipeline;
- a hybrid semantic-planner plus deterministic or search-based placement system;
- a candidate-generation, render, critique, and iterative-refinement system.

You may add stronger alternatives. Compare semantic fidelity, visual quality potential, legality, implementation effort, runtime cost, debuggability, dataset needs, and failure modes. Recommend one target architecture, but identify uncertainty honestly.

### 7. Proposed target pipeline

Provide a concrete staged architecture. Specify the artifact and contract produced by each stage. Show how inventory facts, suggestion intent, feature priorities, symmetry/proportion constraints, geometry, validation feedback, visual critique, and user feedback persist through the pipeline. A diagram is encouraged.

### 8. Evaluation and benchmark plan

Design an offline and online evaluation system that can reveal real progress. Include:

- a stratified prompt suite for direct requests;
- varied inventories, including the current 85-piece example;
- an inventory-driven suggestion benchmark;
- deterministic fixture/reference builds where useful;
- legality metrics;
- semantic feature coverage;
- multi-view silhouette/proportion metrics;
- creativity and within-batch diversity;
- pairwise human preference;
- user acceptance, regeneration, edit burden, and abandonment;
- cost and latency;
- prevention of evaluator gaming;
- sample sizes or confidence methods appropriate for early experiments.

Explain which metrics can be automatic, which require human judgment, and which can be assisted by a multimodal model.

### 9. Controlled experiments

Specify a sequence of experiments that isolates the major variables. At minimum, include tests for:

- current versus stronger models at each stage;
- current suggestion prompt versus feasibility-aware diverse search;
- one candidate versus best-of-N;
- disposable suggestion text versus a persistent canonical design brief;
- raw coordinates versus at least one structured intermediate representation;
- no visual critic versus multi-view render critique;
- Backboard-translated schema/tools versus the best available native structured-output/tool path;
- current 17 shapes versus a controlled expanded catalog;
- current AI builds versus skilled manual or deterministic reference builds using the same inventory.

For every experiment, define the changed variable, fixed variables, dataset, scoring method, likely cost, success threshold, and decision enabled by the result.

### 10. Ranked roadmap

Produce one prioritized roadmap spanning immediate diagnostics, near-term prompt/model tuning, medium-term pipeline upgrades, and the longer-term redesign. Use a table with these columns:

- rank;
- recommendation;
- problem addressed;
- evidence/rationale;
- expected quality impact;
- implementation effort;
- runtime/token cost impact;
- dependencies;
- principal risk;
- validation experiment;
- measurable success criterion.

The ranking must reflect expected quality gain per unit effort while accounting for architectural leverage. Include an explicit top three actions to start with.

### 11. Anti-roadmap

List attractive-sounding actions that should not be prioritized yet, why the evidence is insufficient, and what prerequisite measurement would change that decision. Include indiscriminate model swapping, endless prompt tweaking without an eval set, and adding specialty parts without first measuring the existing catalog's achievable quality.

### 12. Sources and confidence

End with the most important sources, unresolved questions, assumptions, and a confidence assessment. Prefer direct links to papers, official docs, and relevant repositories. Date-sensitive claims about model/provider capabilities must be verified as of the research date.

## Standards for the answer

- Diagnose before prescribing.
- Do not mistake schema validity or physical legality for design quality.
- Do not assume the user's dissatisfaction is solved by more pieces, a larger context window, a higher temperature, or a newer model.
- Do not dismiss the 17-shape catalog without a controlled comparison against what is achievable using those same shapes.
- Do not recommend fine-tuning or training a preference model without specifying the required data, baseline, cost, and why inference-time methods are insufficient.
- Do not recommend a deterministic solver as a magic solution: explain what semantic information it would consume and what objective it would optimize.
- Do not recommend a vision critic without explaining rendering views, rubric, calibration, evaluator bias, and how critique becomes safe local changes.
- Identify interactions and sequencing. For example, best-of-N is of limited value without a scorer, and a scorer cannot be trusted without a benchmark.
- Include concrete examples tied to this system, such as how a “fire hydrant,” “park bench,” or “coffee mug” suggestion would be represented, feasibility-checked, built, and evaluated more effectively.
- Clearly label facts, inferences, and proposals.
- Be decisive. Where evidence supports several options, recommend the next experiment that resolves the choice rather than hiding behind “it depends.”

The final report should leave us able to decide both what to change immediately and what architecture to build toward, with a ranked, measurable path rather than another round of undirected prompt experimentation.
