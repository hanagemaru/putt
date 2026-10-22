import type { Language } from './i18n';

interface ShareResult {
  tourId: string;
  tourName: string;
  totalStrokes: number;
  totalPar: number;
  gaveUp: boolean;
}

/** Only public game results; no player identity, credentials or current URL parameters. */
export function resultShareUrl(result: ShareResult, language: Language): string {
  const diff = result.totalStrokes - result.totalPar;
  const score = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff);
  const note = result.gaveUp
    ? language === 'ja' ? '（ギブアップあり）' : ' (includes a conceded hole)'
    : '';
  const text = language === 'ja'
    ? `Putt · ${result.tourName}\n9ホール ${result.totalStrokes}打 (${score})${note}\nこのスコアを超えられる？`
    : `Putt · ${result.tourName}\n9 holes in ${result.totalStrokes} strokes (${score})${note}\nCan you beat my score?`;
  const game = new URL('https://putt.hanage.app/');
  game.search = new URLSearchParams({ tour: result.tourId, lang: language, utm_source: 'x', utm_medium: 'share' }).toString();
  const intent = new URL('https://x.com/intent/tweet');
  intent.search = new URLSearchParams({ text, url: game.toString() }).toString();
  return intent.toString();
}
