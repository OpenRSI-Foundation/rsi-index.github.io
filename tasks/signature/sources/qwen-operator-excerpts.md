# Qwen operator report: original source excerpts

Extracted on 9 September 2026 from the preserved, pre-rewrite `formal-v8-research-visualization.html`. The report describes the 6–7 September research window.

**These are original source claims, not the corrected article’s conclusions.** The original control scores and proxy description differ from the archived release contract. This file preserves those differences. It is an excerpt of an operator report, not the research agent’s raw transcript or independent verification.

Paragraph wording and numerical values below are reproduced from the source. HTML styling is removed; tables are transcribed to Markdown with their original cell text. Source line numbers refer to the preserved original HTML. Editorial headings and this introduction are added for navigation.

## Research behavior

Source line 585.

> Probe use was suggested, not required. The Agent chose to devote most of its compute envelope to measuring which records were likely to produce non-zero GRPO advantage.

> 31 / 33 — GPU nodes serving probes at peak

> 11 — complete data revisions admitted before freeze

> 0.8747 → 0.9243 — OPEN predicted informative fraction

> 0 — Guard enforcement violations

The four value/label pairs above are transcribed from source lines 589–592.

### Probe use was voluntary

Source line 663.

> The Agent inspected the reward semantics, decided direct data measurement was valuable, and expanded from a small probe set to 31 concurrent GPU nodes.

### Do not rank raw k=8 rates

Source line 664.

> The Agent introduced empirical-Bayes shrinkage so a few lucky or unlucky samples would not dominate selection.

### OPEN versus GUARD

Source line 665.

> OPEN pursued maximum predicted learning signal. GUARD priced in empty responses and long completions to retain operational headroom.

### Eleven valid admissions

Source line 666.

> The Agent repeatedly preserved complete candidate pools rather than waiting until the final minute to create its first recoverable artifact.

### Training screens were optional

Source line 667.

> When small development training attempts failed at infrastructure startup, the Agent recovered by concentrating on the measurement path it could execute reliably.

### Spend the last hours on replication

Source line 668.

> The Agent chose additional final-pool measurement over optional in-window trusted evidence; the Guard still froze the latest data-valid admission.

## Search proxy and reported milestones

Source line 647.

> For each prompt, the Agent used released-checkpoint samples to estimate whether a GRPO group would contain both successes and failures. Such groups can produce non-zero advantage.

Source line 649.

> It applied empirical-Bayes shrinkage to reduce k=8 sampling noise. GUARD used the same estimator with additional empty-response and completion-length safeguards.

Source line 648; mathematical formatting retained.

> OPEN agg = mean<sub>5 capabilities</sub><br>P(group is non-unanimous | probe evidence)

Source line 650.

> Scientific boundary: OPEN/GUARD explain the search strategy. The five held-out scores validate the final artifact. The proxy is not itself a held-out result.

Original milestone table, source lines 638–641.

| Milestone | OPEN | GUARD |
| --- | --- | --- |
| early search | 0.8747 | — |
| Sep 6 · 18:37 UTC | 0.9150 | 0.8990 |
| Sep 7 · 00:26 UTC | 0.9221 | 0.9077 |
| Sep 7 · 03:28 UTC | 0.9243 | 0.9094 |

## Concrete synthetic-data sample descriptions

### Exact quantitative reasoning

Source line 701.

> Observed sample: a 16-term, 13-digit exact sum with a label independently recomputed from the rendered prompt.

### Multiple-choice reasoning

Source line 702.

> Observed sample: four arithmetic options sharing mod 9, mod 11, and the final six digits, preventing cheap partial checks.

### Composable constraints

Source line 703.

> Observed sample: exact paragraph count, required first word, and repeated-keyword constraints encoded in the trusted IFBench schema.

### Distributed aggregation

Source line 704.

> Observed sample: aggregate 16 target readings scattered through a 300-entry, ~44k-character station log; label recomputation matched.

### Executable program synthesis

Source line 705.

> Observed sample: a string-normalization DSL with nine ordered operations; an independent reference implementation passed all 24 supplied tests.

## Original reported results

Original results table, source lines 528–554. This is the operator-report table, including its original control values and rounded means.

| Checkpoint / training data | PolyMath Capability · Math | LongBench V2 Capability · Long Context | IFBench Capability · Instruction Following | LiveCodeBench Capability · Coding | MMLU-Pro Capability · MCQA | Equal-weight macro Five benchmark aggregates |
| --- | --- | --- | --- | --- | --- | --- |
| t0 Original Checkpoint Before final training | 68.06 | 64.02 | 67.01 | 72.06 | 86.30 | 71.490 |
| t40 Human Pick / Anchor Data Matched human-selected control | 68.21 | 63.42 | 66.67 | 73.43 | 86.81 | 71.708 |
| t40 Research Agent Data 24-hour frozen synthetic intervention | 68.21 | 64.02 | 67.35 | 73.54 | 86.44 | 71.912 |

## Original limitations and provenance

Source line 733.

> The displayed values are point estimates. No replicate seeds, confidence intervals, or significance test are attached.

Source line 734.

> Human Pick and Anchor refer to the same matched t40 control run; there is no separate third t40 Human Pick result.

Source line 737.

> The equal-weight macro combines heterogeneous benchmark aggregates and is a presentation summary rather than a pooled-sample statistic.

Source line 739.

> OPEN and GUARD are research-time proxy estimates. Their increases are not claimed to causally explain every downstream score change.

Source line 740.

> Thirty-one probe nodes and eleven admissions are dependent operational events, not independent statistical samples.

Source line 741.

> The frozen revision carried no optional in-window trusted-final-evidence stamp; downstream held-out evaluation was performed separately.

Source line 742.

> Before external publication, attach the exact Human Pick / Anchor and Research Agent checkpoint hashes plus raw evaluator receipts to the aggregate result record.

Source line 745.

> Provenance. Contract geometry, frozen-data identity, and evaluator inventories are repository-bound. Aggregate scores and OPEN/GUARD operational telemetry are supplied by the task operator and isolated in a machine-readable companion file pending final checkpoint/evaluator receipt binding.

## Related material

- [Qwen task details](../../qwen-122b-rl-merge.html)
- [Archived release contract](qwen-release-contract.md)
- [Transcribed scores, milestones, and source notes](qwen-evidence.json)
