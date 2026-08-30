# RSI-Index website

Static site for the RSI-Index project — https://github.com/RSI-Index

No build step, no dependencies. Plain HTML/CSS/JS.

## Structure

```
index.html                        # home: search-field hero, principles, measure, signature tasks
tasks.html                        # signature tasks + community 1-node tasks, task anatomy
blog.html                         # blog index
blog/introducing-rsi-index.html   # announcement post
contribute.html                   # contribution workflow, gates, Harbor deliverable
assets/style.css                  # shared stylesheet (design tokens at the top)
assets/site.js                    # nav toggle, task filters, scroll reveals
assets/tree.js                    # the search field — interactive experiment-tree canvas
assets/favicon.svg
assets/og.png                     # social card (crop of the hero)
```

## The search field (`assets/tree.js`)

The hero (and every subpage header) runs an illustrative simulation of the RSI
loop: an agent explores a tree of runs from a frozen human baseline. Node
brightness tracks score, a new best sends a pulse down its lineage, and hard
policy violations flash orange and are pruned to a reward of zero.

- **Hover** a run — its lineage lights up with a staggered sweep and a tooltip
  shows the run's score vs baseline and the mutation it tried.
- **Click** a run — the agent branches the search from it.
- Sections opt in with `data-tree-hero` (dense, with the live readout strip)
  or `data-tree-head` (ambient) plus a `<canvas>` child.
- Respects `prefers-reduced-motion` (renders one static frame, hover still
  works); pauses off-screen and in hidden tabs; caps DPR at 2.
- `?shot=1` fast-forwards the simulation and disables entrance animations —
  useful for screenshots.

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
  The system: deep ink-indigo "field" surfaces (`--field*`) with lavender
  node-light and amber accents, and warm paper documentation sections.
- Each page carries its own copy of the nav/footer — when editing them, update all
  five HTML files.
- To add a blog post: copy `blog/introducing-rsi-index.html`, edit, and add a card
  to `blog.html`.
- Content source: "ALE - RSI Framework v0.1".
