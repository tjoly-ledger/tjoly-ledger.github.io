/* Renders the index cards from projects.json.
   Note: fetch() is blocked under file:// — preview over HTTP
   (`python3 -m http.server`), which is how GitHub Pages serves it anyway. */

const ACCENTS = ['teal', 'indigo', 'amber', 'pink', 'violet'];
const SPRITE = new Set(
  [...document.querySelectorAll('svg symbol')].map((s) => s.id.replace(/^icon-/, ''))
);

function svgIcon(name, cls) {
  const id = SPRITE.has(name) ? name : 'default';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-' + id);
  svg.appendChild(use);
  return svg;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function buildCard(project, index) {
  const accent = ACCENTS.includes(project.accent) ? project.accent : 'teal';
  const soon = project.soon === true || !project.href;
  const card = document.createElement(soon ? 'div' : 'a');
  card.className = 'card accent-' + accent + (soon ? ' is-soon' : '');
  card.style.setProperty('--i', (0.18 + index * 0.06).toFixed(2) + 's');

  if (!soon) {
    card.href = project.href;
    if (project.external) {
      card.target = '_blank';
      card.rel = 'noopener';
    }
  }

  const top = el('div', 'card-top');
  const icon = el('div', 'card-icon');
  icon.appendChild(svgIcon(project.icon, null));
  top.appendChild(icon);
  if (project.badge) {
    top.appendChild(el('span', 'card-badge', soon ? 'Soon' : project.badge));
  }

  const body = el('div', 'card-body');
  body.appendChild(el('div', 'card-title', project.title || 'Untitled'));
  if (project.desc) body.appendChild(el('div', 'card-desc', project.desc));

  const footer = el('div', 'card-footer');
  const cta = el('span', 'card-cta', soon ? 'Coming soon' : project.cta || 'Open');
  if (!soon) cta.appendChild(svgIcon('arrow-right', null));
  footer.appendChild(cta);

  card.append(top, body, footer);
  return card;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node && value != null) node.textContent = value;
}

function renderError(message) {
  const card = el('div', 'card accent-amber');
  card.style.setProperty('--i', '0.1s');
  const top = el('div', 'card-top');
  const icon = el('div', 'card-icon');
  icon.appendChild(svgIcon('alert', null));
  top.appendChild(icon);
  const body = el('div', 'card-body');
  body.appendChild(el('div', 'card-title', 'Could not load projects.json'));
  body.appendChild(el('div', 'card-desc', message));
  card.append(top, body);
  document.getElementById('cards').replaceChildren(card);
}

fetch('projects.json', { cache: 'no-cache' })
  .then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then((data) => {
    const site = data.site || {};
    setText('site-label', site.label);
    setText('site-env', site.env);
    setText('site-footer', site.footer);
    setText('site-meta', site.meta);
    setText('site-version', site.version);
    document.title = site.title || document.title;

    const projects = Array.isArray(data.projects) ? data.projects : [];
    document.getElementById('cards').replaceChildren(
      ...projects.map((project, i) => buildCard(project, i))
    );
  })
  .catch((err) => {
    renderError(
      err.message +
        ' — serve the site over HTTP (fetch is blocked on the file:// protocol).'
    );
  });
