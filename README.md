# RSI-Index website

Static site for the RSI-Index project — https://github.com/RSI-Index

No build step, no dependencies. Plain HTML/CSS/JS.

## Structure

```
index.html                        # home: star-field hero, how a run works, principles, measure, signature tasks
tasks.html                        # signature tasks + community 1-node tasks, task anatomy
blog.html                         # blog index
blog/introducing-rsi-index.html   # announcement post
contribute.html                   # contribution workflow, gates, Harbor deliverable
assets/style.css                  # shared stylesheet (design tokens at the top)
assets/site.js                    # nav toggle, task filters, scroll reveals
assets/field.js                   # the star field — flow-field star map (drag / zoom)
assets/favicon.svg
assets/og.png                     # social card (crop of the hero)
```

## The star field (`assets/field.js`)

The hero (and every subpage header) is a long-exposure star map: thousands of
white points drift along a smooth flow — a vortex around a bright pole plus a
periodic, divergence-free potential field — leaving trails, while faint blue
streamlines with arrowheads trace the same flow. The field loops every ~52 s
with a slow phase drift, so no two passes are identical.

- **Drag** to pan · **ctrl/⌘ + scroll** or **pinch** to zoom · **double-click**
  to reset. Plain scrolling over the hero still scrolls the page.
- Sections opt in with `data-field-hero` (interactive) or `data-field-head`
  (ambient) plus two `<canvas>` children: `.field-lines` and `.field-stars`.
- Respects `prefers-reduced-motion` (one static exposure, interactions still
  re-render); pauses off-screen and in hidden tabs; caps DPR at 2.
- `?shot=1` disables entrance animations — useful for screenshots.

## How a run works (the diagram)

`index.html#how-a-run-works` is a pure HTML/CSS diagram of the RSI Harness
run: the persistent Work container with the agent's inner research loop, the
fresh-per-submission Judge container, the outer loop of rounds, and the final
score. The round bars show a real run (`learnability-cot`, 6 rounds, best in
round 5) taken from the harness logs.

## Local preview

```bash
python3 -m http.server 8000
```

then open http://localhost:8000

## Deploy to GitHub Pages

Recommended: publish as the organization site so it lives at
`https://rsi-index.github.io/`.

1. Create a repo named `rsi-index.github.io` under the RSI-Index org.
2. Push the contents of this folder to its `main` branch.
3. In the repo: Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.

For a custom domain, add a `CNAME` file containing the domain and set the DNS
`CNAME` record to `rsi-index.github.io`.

## Editing notes

- Design tokens (colors, fonts) are CSS variables at the top of `assets/style.css`.
  The system: black-blue "field" surfaces (`--field*`) with white light and a
  single electric-blue accent, and neutral white documentation sections.
- Each page carries its own copy of the nav/footer — when editing them, update all
  five HTML files.
- To add a blog post: copy `blog/introducing-rsi-index.html`, edit, and add a card
  to `blog.html`.
- Content source: "ALE - RSI Framework v0.1".
