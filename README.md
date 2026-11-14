# quaiyyumfaisal.github.io

Personal website of Faisal Quaiyyum: <https://quaiyyumfaisal.github.io>

Built with [Jekyll](https://jekyllrb.com/). GitHub Pages builds and publishes it automatically on every commit, so there's nothing to install.

## Add a note

Create a new file in `_notes/` (on github.com: open the `_notes` folder → **Add file → Create new file**). The file name becomes the URL: `_notes/my-topic.md` → `/notes/my-topic/`.

````markdown
---
title: "My Note Title"
date: 2026-11-20
last_updated: November 2026
description: "One-line summary shown on the Notes page."
tags: [Macroeconomics, Python]
math: true        # optional: turns on LaTeX rendering
---

Write in normal Markdown. **Bold**, *italic*, [links](https://example.com), lists, tables…

## A section heading

Inline math: $$\beta = \frac{\mathrm{Cov}(r_i, r_m)}{\mathrm{Var}(r_m)}$$

Display math (put it on its own lines):

$$
V_t = \max_{c_t} \; u(c_t) + \beta \, \mathbb{E}_t V_{t+1}
$$

```python
import pandas as pd   # code blocks get syntax highlighting + a Copy button
```
````

Notes are sorted by `date` (newest first). Images go in `assets/img/notes/` and are used like `![Alt text](/assets/img/notes/figure.png)`.

To list a note that lives on another site, add `external_url: https://…` to the front matter (see `_notes/quantmfr-uncertainty-expansion.md`).

## Add or edit a paper

Edit `_data/research.yml`. Copy an existing entry, paste it at the top of the section you want, and edit the fields. Set `featured: true` to also show it under **Selected Research** on the home page. An `abstract:` field adds a collapsible Abstract toggle.

## Update the CV

Upload the new PDF to the repository root, then change the `cv:` line in `_config.yml` (e.g. `cv: /CV_Dec26.pdf`).

## Change the photo, links, or bio

- Photo: replace `assets/img/profile.jpg` (square works best).
- Email, Scholar, LinkedIn, X, GitHub: the `author:` block in `_config.yml`.
- Bio text (Personal Narrative, Comfort Zone, research interests): `index.html`.
- Accent color: `--accent` and `--accent-rgb` at the top of `assets/css/main.css`.

## Preview locally (optional)

```sh
bundle install
bundle exec jekyll serve   # http://localhost:4000
```

## Credits

Font: Segoe UI where installed; otherwise [Selawik](https://github.com/microsoft/Selawik) (Microsoft, SIL Open Font License), bundled in `assets/fonts/selawik/`.
