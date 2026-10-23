import { createResultImage } from './result-image';
import { resultShareData, type ShareResult } from './result-share';
import { bindResultShare } from './share-action';
import type { Language } from './i18n';
import type { HoleScore } from './round';

let dispose: (() => void) | null = null;

export function resetImageShare(): void {
  dispose?.();
  dispose = null;
  document.getElementById('score-share')!.hidden = true;
}

export function prepareImageShare(result: ShareResult, scores: readonly HoleScore[], lang: Language): void {
  resetImageShare();
  const button = document.getElementById('score-share') as HTMLButtonElement;
  button.hidden = false;
  dispose = bindResultShare(button, resultShareData(result, lang), createResultImage(result, scores, lang), lang);
}
