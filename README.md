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

## Preview locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.
