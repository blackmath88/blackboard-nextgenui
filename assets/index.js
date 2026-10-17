// Optional: the thread through "The path" fills in as each step scrolls into view.
// Without JS (or without IntersectionObserver) the thread is drawn in full.
(function () {
  if (!('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js');
  var steps = document.querySelectorAll('.thread .step');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('seen');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -20% 0px' });
  steps.forEach(function (s) { io.observe(s); });
})();
