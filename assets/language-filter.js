(function () {
  const buttons = [...document.querySelectorAll('[data-language]')];
  const entries = [...document.querySelectorAll('.relay > [data-lang]')];
  const note = document.getElementById('path-note');
  if (!buttons.length || !entries.length) return;

  const copy = {
    en: 'Showing the English entries. Choose DE to see the German explainers.',
    de: 'Showing the German explainers. Choose EN to return to the English entries.'
  };

  function setLanguage(language, remember) {
    const selected = language === 'de' ? 'de' : 'en';
    const visible = entries.filter(entry => entry.dataset.lang === selected);

    entries.forEach(entry => {
      entry.hidden = entry.dataset.lang !== selected;
      entry.classList.remove('is-first', 'is-last');
    });
    visible[0]?.classList.add('is-first');
    visible.at(-1)?.classList.add('is-last');

    buttons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === selected));
    });
    note.textContent = copy[selected];

    const url = new URL(window.location.href);
    if (selected === 'de') url.searchParams.set('lang', 'de');
    else url.searchParams.delete('lang');
    history.replaceState(null, '', url);

    if (remember) {
      try { localStorage.setItem('blackboard-language', selected); } catch (_) {}
    }
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => setLanguage(button.dataset.language, true));
  });

  const queryLanguage = new URLSearchParams(window.location.search).get('lang');
  let savedLanguage = null;
  try { savedLanguage = localStorage.getItem('blackboard-language'); } catch (_) {}
  setLanguage(queryLanguage || savedLanguage || 'en', false);
})();
