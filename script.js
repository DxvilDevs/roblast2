const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const navLinks = [...document.querySelectorAll('.nav-link[href^="#"]')];

function updateHeader() {
  if (header) header.classList.toggle('scrolled', window.scrollY > 18);
}
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('.nav-link')) {
      nav.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open menu');
    }
  });
}

const sections = [...document.querySelectorAll('main section[id]')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-38% 0px -52% 0px', threshold: 0 });
sections.forEach((section) => sectionObserver.observe(section));

function gameCardTemplate(game) {
  const tags = game.tags.map((tag) => `<span>${tag}</span>`).join('');
  return `
    <article class="game-card reveal" data-roblox-place-id="${game.placeId}">
      <a class="game-art" href="${game.url}" target="_blank" rel="noreferrer">
        <img src="${game.thumbnail}" alt="${game.name}" loading="lazy" />
        <span class="game-badge">LIVE</span>
        <span class="game-play">PLAY ↗</span>
      </a>
      <div class="game-info">
        <div>
          <h3>${game.icon} ${game.name}</h3>
          <p>${game.description}</p>
        </div>
        <div class="game-meta">${tags}</div>
      </div>
    </article>`;
}

function renderGames() {
  if (!Array.isArray(ROBLAST_GAMES)) return;
  const homeGrid = document.querySelector('#games-grid');
  const catalogueGrid = document.querySelector('#catalogue-grid');
  const cards = ROBLAST_GAMES.map(gameCardTemplate).join('');
  if (homeGrid) homeGrid.innerHTML = cards;
  if (catalogueGrid) catalogueGrid.innerHTML = cards;
}

renderGames();

const reveals = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
reveals.forEach((item, index) => {
  item.style.transitionDelay = `${Math.min(index % 4, 3) * 65}ms`;
  revealObserver.observe(item);
});

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

/* ---------------------------------------------------------------
   Live Roblox studio statistics
   ---------------------------------------------------------------
   Add a game to games-data.js and it is automatically included in:
   - total games
   - live CCU
   - total visits
   - total favourites

   Roblox exposes the public game detail and favourites-count endpoints
   without requiring an authenticated user. We resolve place IDs to
   universe IDs first, cache those IDs locally, then refresh the numbers.
---------------------------------------------------------------- */
const statsElements = {
  games: document.getElementById('stat-games'),
  ccu: document.getElementById('stat-ccu'),
  visits: document.getElementById('stat-visits'),
  favourites: document.getElementById('stat-favourites'),
  status: document.getElementById('stats-status')
};

const universeCacheKey = 'roblast-universe-ids-v1';
const statsRefreshMs = 60_000;
let statsRefreshTimer = null;
let statsRequestRunning = false;

function readUniverseCache() {
  try {
    return JSON.parse(localStorage.getItem(universeCacheKey) || '{}');
  } catch {
    return {};
  }
}

function writeUniverseCache(cache) {
  try {
    localStorage.setItem(universeCacheKey, JSON.stringify(cache));
  } catch {
    // Storage can be disabled in private browsing. Runtime still works.
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function resolveUniverseId(game, cache) {
  if (game.universeId) return String(game.universeId);
  if (cache[game.placeId]) return String(cache[game.placeId]);

  const data = await fetchJson(`https://apis.roblox.com/universes/v1/places/${encodeURIComponent(game.placeId)}/universe`);
  const universeId = data?.universeId;
  if (!universeId) throw new Error(`No universe returned for ${game.name}`);

  cache[game.placeId] = String(universeId);
  writeUniverseCache(cache);
  return String(universeId);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    notation: 'compact',
    maximumFractionDigits: value >= 100_000 ? 1 : 2
  }).format(value);
}

function formatUpdatedTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

async function updateLiveStats() {
  if (!statsElements.games || !Array.isArray(ROBLAST_GAMES) || !ROBLAST_GAMES.length) return;
  if (statsRequestRunning) return;
  statsRequestRunning = true;

  const games = [...new Map(ROBLAST_GAMES.map((game) => [String(game.placeId), game])).values()];
  statsElements.games.textContent = String(games.length).padStart(2, '0');
  if (statsElements.status) statsElements.status.textContent = 'Updating live Roblox stats…';

  try {
    const cache = readUniverseCache();
    const resolved = await Promise.allSettled(games.map(async (game) => ({
      game,
      universeId: await resolveUniverseId(game, cache)
    })));

    const usable = resolved
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);

    if (!usable.length) throw new Error('No Roblox universes could be resolved.');

    const universeIds = usable.map(({ universeId }) => universeId);
    const detailsUrl = `https://games.roblox.com/v1/games?universeIds=${universeIds.join(',')}`;
    const detailsData = await fetchJson(detailsUrl);

    const details = Array.isArray(detailsData?.data) ? detailsData.data : [];
    const byUniverse = new Map(details.map((item) => [String(item.id), item]));

    const favouriteResults = await Promise.allSettled(
      universeIds.map(async (universeId) => {
        const data = await fetchJson(`https://games.roblox.com/v1/games/${encodeURIComponent(universeId)}/favorites/count`);
        return Number(data?.favoritesCount ?? 0);
      })
    );

    let totalCCU = 0;
    let totalVisits = 0;
    for (const universeId of universeIds) {
      const detail = byUniverse.get(String(universeId));
      if (!detail) continue;
      totalCCU += Number(detail.playing ?? 0);
      totalVisits += Number(detail.visits ?? 0);
    }

    let totalFavourites = 0;
    favouriteResults.forEach((result) => {
      if (result.status === 'fulfilled' && Number.isFinite(result.value)) totalFavourites += result.value;
    });

    statsElements.ccu.textContent = formatNumber(totalCCU);
    statsElements.visits.textContent = formatNumber(totalVisits);
    statsElements.favourites.textContent = formatNumber(totalFavourites);

    const failedGames = games.length - usable.length;
    const suffix = failedGames ? ` · ${failedGames} game${failedGames === 1 ? '' : 's'} unavailable` : '';
    if (statsElements.status) {
      statsElements.status.textContent = `Updated ${formatUpdatedTime(new Date())}${suffix}`;
    }
  } catch (error) {
    console.warn('RoBlast live stats update failed:', error);
    if (statsElements.status) {
      statsElements.status.textContent = 'Roblox stats are temporarily unavailable.';
    }
  } finally {
    statsRequestRunning = false;
  }
}

updateLiveStats();
if (statsElements.games) {
  statsRefreshTimer = window.setInterval(updateLiveStats, statsRefreshMs);
}
