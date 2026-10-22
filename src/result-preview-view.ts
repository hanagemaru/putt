// Imported only for the preview-only sample route. No game engine or ranking setup.
import { Round } from './round';
import { tourById } from './course/tour-holes';
import { language } from './i18n';
import { ensurePixelFont } from './pixel-font';
import { renderRoundResult } from './round-result-view';

const tour = tourById(new URLSearchParams(location.search).get('tour'));
const sample = new Round(tour.seeds);
for (let index = 0; index < tour.seeds.length; index++) {
  const par = 3 + index % 3;
  sample.recordHole(par, par + (index % 3 === 0 ? 1 : 0), true);
  sample.next();
}
ensurePixelFont(language());
for (const id of ['hud', 'home-button', 'camera-controls', 'stroke-camera-controls', 'rotate-overlay']) {
  document.getElementById(id)?.remove();
}
renderRoundResult(sample, tour);
document.getElementById('score-note')!.textContent = 'PREVIEW';
for (const id of ['score-course', 'score-again', 'score-home']) {
  document.getElementById(id)?.addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = id === 'score-again' ? new URLSearchParams({ tour: tour.id }).toString() : id === 'score-course' ? 'menu=tour' : '';
    location.assign(url.toString());
  });
}
