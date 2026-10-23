import type { Language } from './i18n';

export interface ShareResult {
  tourId: string;
  tourName: string;
  totalStrokes: number;
  totalPar: number;
  gaveUp: boolean;
}

/** Only public game results; no player identity, credentials or current URL parameters. */
export function resultShareData(result: ShareResult, language: Language): { text: string; url: string } {
  const diff = result.totalStrokes - result.totalPar;
  const score = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff);
  const note = result.gaveUp
    ? language === 'ja' ? '（ギブアップあり）' : ' (includes a conceded hole)'
    : '';
  const text = language === 'ja'
    ? `Putt｜${result.tourName}\n${result.totalStrokes}打（${score}）${note}`
    : `Putt | ${result.tourName}\n${result.totalStrokes} strokes (${score})${note}`;
  const game = new URL('https://putt.hanage.app/');
  game.search = new URLSearchParams({ tour: result.tourId, lang: language, utm_source: 'share', utm_medium: 'share' }).toString();
  return { text, url: game.toString() };
}
