import { createResultImage } from './result-image';
import { resultShareData, type ShareResult } from './result-share';
import { t, type Language } from './i18n';
import type { HoleScore } from './round';

let generation = 0;
let objectUrl: string | null = null;

export function resetImageShare(): void {
  generation++;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  const button = document.getElementById('score-image-share') as HTMLButtonElement;
  button.hidden = true;
  button.onclick = null;
  const preview = document.getElementById('score-image-preview') as HTMLDetailsElement;
  preview.hidden = true;
  preview.open = false;
  document.getElementById('score-image-status')!.textContent = '';
  document.getElementById('score-image')!.removeAttribute('src');
  document.getElementById('score-image-download')!.removeAttribute('href');
}

export function prepareImageShare(result: ShareResult, scores: readonly HoleScore[], lang: Language): void {
  resetImageShare();
  const currentGeneration = generation;
  const copy = t();
  const button = document.getElementById('score-image-share') as HTMLButtonElement;
  const preview = document.getElementById('score-image-preview') as HTMLDetailsElement;
  const image = document.getElementById('score-image') as HTMLImageElement;
  const download = document.getElementById('score-image-download') as HTMLAnchorElement;
  const status = document.getElementById('score-image-status')!;
  button.hidden = false;
  button.disabled = true;
  button.textContent = copy.imagePreparing;
  // Prepare before the click, so navigator.share retains iOS user activation.
  void createResultImage(result, scores, lang).then(file => {
    if (currentGeneration !== generation) return;
    objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.alt = `${result.tourName}: ${result.totalStrokes}`;
    download.href = objectUrl;
    download.textContent = copy.saveImage;
    preview.querySelector('summary')!.textContent = copy.viewShareImage;
    preview.hidden = false;
    let canShare = false;
    try { canShare = !!navigator.canShare?.({ files: [file] }) && !!navigator.share; } catch { /* Use save. */ }
    button.textContent = canShare ? copy.shareImage : copy.saveImage;
    button.disabled = false;
    button.onclick = () => {
      status.textContent = '';
      if (!canShare) {
        download.click();
        status.textContent = copy.imageSaveNote;
        return;
      }
      const data = resultShareData(result, lang, 'share');
      button.disabled = true;
      try {
        void navigator.share({ files: [file], text: `${data.text}\n${data.url}` }).catch(error => {
          if (currentGeneration === generation && error?.name !== 'AbortError') status.textContent = copy.imageShareFailed;
        }).finally(() => { if (currentGeneration === generation) button.disabled = false; });
      } catch {
        button.disabled = false;
        status.textContent = copy.imageShareFailed;
      }
    };
  }).catch(() => {
    if (currentGeneration !== generation) return;
    button.hidden = true;
    status.textContent = lang === 'ja' ? '画像を作れませんでした。Xの文章共有をご利用ください。' : 'Image unavailable. You can still share text on X.';
  });
}
