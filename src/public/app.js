/* kno onboarding wizard */

// ─── Typing animation (landing hero) ─────────────────────────────────────────

(function startTyping() {
  const el = document.getElementById('typing-text');
  if (!el) return;

  const phrases = [
    'hunting happy hours',
    'filling your Friday',
    'finding your next concert',
    'on autopilot',
  ];

  let pi = 0, ci = 0, deleting = false;
  const TYPING_SPEED = 55;
  const DELETE_SPEED = 28;
  const PAUSE_AFTER = 1800;
  const PAUSE_BEFORE = 300;

  function tick() {
    const phrase = phrases[pi];
    if (!deleting) {
      el.textContent = phrase.slice(0, ++ci);
      if (ci === phrase.length) {
        deleting = true;
        setTimeout(tick, PAUSE_AFTER);
        return;
      }
    } else {
      el.textContent = phrase.slice(0, --ci);
      if (ci === 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
        setTimeout(tick, PAUSE_BEFORE);
        return;
      }
    }
    setTimeout(tick, deleting ? DELETE_SPEED : TYPING_SPEED);
  }

  setTimeout(tick, 600);
})();

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  userId: null,
  step: 1,
  locations: { home: '', work: '' },
  preferences: {
    drink: [],
    food: [],
    dietary: [],
    event_types: [],
    vibe: [],
    activity_level: 'medium',
    indoor_outdoor: 'no_preference',
    budget: 'moderate',
    max_distance_miles: 5,
  },
  schedule: {
    frequency: '2x_week',
    days: ['wednesday', 'thursday', 'friday'],
    max_proposals: 2,
  },
};

// ─── Init ─────────────────────────────────────────────────────────────────────

(function init() {
  const params = new URLSearchParams(window.location.search);
  const step = parseInt(params.get('step') ?? '1', 10);
  const uid = params.get('uid');

  if (uid) {
    state.userId = parseInt(uid, 10);
    localStorage.setItem('kno_user_id', uid);
  } else {
    const stored = localStorage.getItem('kno_user_id');
    if (stored) {
      state.userId = parseInt(stored, 10);
      // Already connected — check onboarding status
      if (step === 1) {
        fetch(`/api/users/onboarding/status?userId=${stored}`)
          .then(r => r.json())
          .then(data => {
            if (data.onboarding_complete) {
              window.location.href = `/proposals`;
            } else {
              goTo(2);
            }
          })
          .catch(() => goTo(2));
        return;
      }
    }
  }

  // Chip grids
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });

  // Toggle buttons (single-select)
  ['toggle-activity', 'toggle-setting', 'toggle-frequency', 'toggle-proposals'].forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    container.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  });

  // Budget options (single-select)
  document.querySelectorAll('#budget-opts .budget-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#budget-opts .budget-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });

  // Distance (single-select)
  document.querySelectorAll('#toggle-distance .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#toggle-distance .toggle-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  goTo(step);
})();

// ─── Navigation ───────────────────────────────────────────────────────────────

function goTo(n) {
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`step-${n}`);
  if (target) target.classList.add('active');
  state.step = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

function chipsSelected(containerId) {
  return [...document.querySelectorAll(`#${containerId} .chip.selected`)]
    .map(c => c.dataset.val);
}

function toggleSelected(containerId) {
  const el = document.querySelector(`#${containerId} .toggle-btn.selected`);
  return el ? el.dataset.val : null;
}

// ─── Step 2: Locations ────────────────────────────────────────────────────────

async function saveLocations() {
  const home = document.getElementById('home-address').value.trim();
  if (!home) {
    alert('Please enter your home address or neighborhood.');
    return;
  }
  state.locations.home = home;
  state.locations.work = document.getElementById('work-address').value.trim();

  if (!state.userId) {
    // User hasn't been created yet (no Google OAuth in dev mode) — skip
    goTo(3);
    return;
  }

  try {
    const res = await fetch('/api/users/onboarding/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId, home, work: state.locations.work }),
    });
    if (!res.ok) throw new Error('Failed to save locations');
    goTo(3);
  } catch (err) {
    alert('Error saving locations. Please try again.');
  }
}

// ─── Step 3: Tastes ───────────────────────────────────────────────────────────

async function saveTastes() {
  const prefs = {
    drink: chipsSelected('chips-drink'),
    food: chipsSelected('chips-food'),
    dietary: chipsSelected('chips-dietary'),
    event_types: chipsSelected('chips-events'),
    vibe: chipsSelected('chips-vibe'),
    activity_level: toggleSelected('toggle-activity') ?? 'medium',
    indoor_outdoor: toggleSelected('toggle-setting') ?? 'no_preference',
    budget: document.querySelector('#budget-opts .budget-opt.selected')?.dataset.val ?? 'moderate',
    max_distance_miles: parseInt(
      document.querySelector('#toggle-distance .toggle-btn.selected')?.dataset.val ?? '5', 10
    ),
  };

  Object.assign(state.preferences, prefs);

  if (!state.userId) { goTo(4); return; }

  try {
    const res = await fetch('/api/users/onboarding/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId, preferences: prefs }),
    });
    if (!res.ok) throw new Error('Failed to save preferences');
    goTo(4);
  } catch {
    alert('Error saving preferences. Please try again.');
  }
}

// ─── Step 4: Schedule ─────────────────────────────────────────────────────────

async function saveSchedule() {
  const schedule = {
    frequency: toggleSelected('toggle-frequency') ?? '2x_week',
    days: chipsSelected('chips-days'),
    max_proposals: parseInt(toggleSelected('toggle-proposals') ?? '2', 10),
  };

  Object.assign(state.schedule, schedule);

  if (!state.userId) { showSummary(); goTo(5); return; }

  try {
    const res = await fetch('/api/users/onboarding/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId, ...schedule }),
    });
    if (!res.ok) throw new Error('Failed to save schedule');
    showSummary();
    goTo(5);
  } catch {
    alert('Error saving schedule. Please try again.');
  }
}

// ─── Step 5: Summary ──────────────────────────────────────────────────────────

function showSummary() {
  const prefs = state.preferences;
  const sched = state.schedule;

  const items = [
    prefs.event_types.length ? `Events: ${prefs.event_types.join(', ').replace(/_/g, ' ')}` : null,
    prefs.drink.length ? `Drinks: ${prefs.drink.join(', ').replace(/_/g, ' ')}` : null,
    `Budget: ${prefs.budget}`,
    `Max distance: ${prefs.max_distance_miles} mi`,
    `Frequency: ${sched.frequency.replace(/_/g, ' ')}`,
    sched.days.length ? `Days: ${sched.days.join(', ')}` : null,
    `Proposals per run: ${sched.max_proposals}`,
  ].filter(Boolean);

  document.getElementById('profile-summary').innerHTML = items
    .map(i => `<p class="text-sm" style="margin-bottom:0.4rem">✓ ${i}</p>`)
    .join('');

  if (state.userId) {
    document.getElementById('proposals-link').href = `/proposals?uid=${state.userId}`;
  }
}
