# tjoly-ledger.github.io

## Add a sub-site

1. Create `my_site/index.html` and link the shared theme with
   `<link rel="stylesheet" href="../assets/style.css">`
2. Append an entry to `projects.json`. No HTML to touch.

```json
{
  "title": "My Site",
  "href": "my_site/",
  "desc": "One or two lines shown on the card.",
  "icon": "chip",
  "accent": "indigo",
  "badge": "Docs",
  "cta": "Open"
}
```

## Games

`ledger_game/` is a canvas game, not a report page, so it does not use the `.report`
layout or `toc.js`. It loads the shared theme for the shell and then its own
`game.css`:

```html
<link rel="stylesheet" href="../assets/style.css">
<link rel="stylesheet" href="game.css">
...
<script src="waves.js"></script>
<script src="game.js"></script>
```

| file | role |
| --- | --- |
| `index.html` | the shell, the HUD, and the menu / game-over overlays as static markup |
| `game.css` | game-only styles: the HUD, the canvas frame, the overlays |
| `waves.js` | the content: `window.NANO_DATA` — attack types, pickups, wave script |
| `game.js` | the engine: fixed-step loop, entities, input, canvas rendering |

Balance and content live entirely in `waves.js`. Adding an attack type is one entry
under `attacks` plus a shape in `drawEnemy`; adding a wave is one entry under `waves`.

Two rules the game depends on:

- **Classic `<script>` tags, no `fetch` and no `type="module"`.** Both are blocked under
  `file://`, so either one would make the page only playable behind a web server.
- **Every animation is driven in JS, not CSS.** The shared sheet ends
  with `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`,
  which would silently freeze anything animated in CSS. The engine reads the same media
  query itself and drops glow, shake and particles instead.

`.eyebrow` is scoped to `.body .eyebrow` in the shared sheet, so a page outside the
report layout has to re-declare it. `game.css` does.

## Preview locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.
