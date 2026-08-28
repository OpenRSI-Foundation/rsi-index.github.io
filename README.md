# RSI-Index website

Static site for the RSI-Index project — https://github.com/RSI-Index

No build step, no dependencies. Plain HTML/CSS/JS.

## Structure

```
index.html                        # home: hero, principles, measure, taxonomy, featured task
tasks.html                        # all 10 tracks / 58 environment lanes, filterable by domain
blog.html                         # blog index
blog/introducing-rsi-index.html   # announcement post
contribute.html                   # contribution workflow, gates, Harbor deliverable
assets/style.css                  # shared stylesheet (design tokens at the top)
assets/site.js                    # hero animation, nav toggle, task filters
assets/favicon.svg
```

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
- Each page carries its own copy of the nav/footer — when editing them, update all
  five HTML files.
- To add a blog post: copy `blog/introducing-rsi-index.html`, edit, and add a card
  to `blog.html`.
- The hero animation lives in `assets/site.js` (`#rsi-canvas`); it respects
  `prefers-reduced-motion` and renders a static frame in that case.
- Content source: "ALE - RSI Framework v0.1".
