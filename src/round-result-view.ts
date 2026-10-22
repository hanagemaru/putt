import type { Round, HoleScore } from './round';
import type { TourDefinition } from './course/tour-holes';
import * as i18n from './i18n';
import { t, language } from './i18n';
import { resultShareUrl } from './result-share';

export function readoutNode(label: string, value: string, tone?: number): HTMLElement {
  const root = document.createElement('span');
  root.className = 'readout';
  const labelNode = document.createElement('span');
  labelNode.className = 'readout-label';
  labelNode.textContent = label;
  const valueNode = document.createElement('span');
  valueNode.className = 'readout-value';
  if (tone !== undefined && tone !== 0) valueNode.classList.add(tone < 0 ? 'under' : 'over');
  valueNode.textContent = value;
  root.append(labelNode, valueNode);
  return root;
}


export function renderRoundResult(current: Round, selectedTour: TourDefinition): void {
  const scoreOverlay = document.getElementById('score-overlay') as HTMLDivElement;
  const scoreCard = document.getElementById('score-card') as HTMLDivElement;
  const scoreTitle = document.getElementById('score-title')!;
  const scoreHeadline = document.getElementById('score-headline')!;
  const scoreStrokes = document.getElementById('score-strokes')!;
  const scoreSub = document.getElementById('score-sub')!;
  const scoreNote = document.getElementById('score-note')!;
  const scoreTable = document.getElementById('score-table') as HTMLTableElement;
  const scoreRows = document.getElementById('score-rows')!;
  const scoreHint = document.getElementById('score-hint') as HTMLDivElement;
  const scoreActions = document.getElementById('score-actions') as HTMLDivElement;
  const scoreCourse = document.getElementById('score-course') as HTMLButtonElement;
  const scoreAgain = document.getElementById('score-again') as HTMLButtonElement;
  const scoreHome = document.getElementById('score-home') as HTMLButtonElement;
  const scoreShare = document.getElementById('score-share') as HTMLAnchorElement;
  const gaveUp = current.scores.some((hole) => !hole.holedOut);
  scoreShare.href = resultShareUrl({
    tourId: selectedTour.id, tourName: selectedTour.name[language()],
    totalStrokes: current.totalStrokes, totalPar: current.totalPar, gaveUp,
  }, language());
  scoreShare.hidden = false;
  scoreTitle.dataset.screen = 'round-end';
  // ラウンド終了に判定語は無い。ホールの結果音を持ち越さないよう消す
  delete scoreTitle.dataset.result;
  scoreTitle.textContent = i18n.roundEndTitle(selectedTour.name[language()]);
  // ラウンドには判定語が無いので、主役は中継のリーダーボードと同じく通算パー差にする
  scoreHeadline.className = 'verdict';
  if (current.toPar !== 0) scoreHeadline.classList.add(current.toPar < 0 ? 'under' : 'over');
  scoreHeadline.textContent = i18n.formatDiff(current.toPar);
  scoreStrokes.textContent = i18n.strokesText(current.totalStrokes);
  scoreSub.replaceChildren(
    readoutNode(i18n.LABEL_HOLES, String(current.holeCount)),
    readoutNode(i18n.LABEL_PAR, String(current.totalPar)),
  );
  scoreNote.textContent = gaveUp ? t().gaveUpNote : '';
  scoreRows.replaceChildren(
    scoreHeaderRow(),
    ...current.scores.map(scoreRow),
    scoreTotalRow(current),
  );
  scoreTable.hidden = false;
  scoreHint.hidden = true;
  scoreCourse.hidden = false;
  scoreAgain.hidden = false;
  scoreHome.hidden = false;
  scoreActions.hidden = false;
  // 一覧表があるぶん縦に長い。字と余白を詰め、収まらない画面では枠の中をスクロールさせる
  scoreCard.classList.add('list');
  scoreOverlay.hidden = false;
}


function scoreCell(tag: 'td' | 'th', text: string, className = ''): HTMLTableCellElement {
  const cell = document.createElement(tag);
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}


function scoreHeaderRow(): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.append(
    scoreCell('th', t().colHole),
    scoreCell('th', t().colPar),
    scoreCell('th', t().colStrokes),
    scoreCell('th', ''),
  );
  return row;
}


function scoreRow(hole: HoleScore): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.append(
    scoreCell('td', String(hole.number)),
    scoreCell('td', String(hole.par)),
    // ギブアップしたホールは印を付けて、カップインしたホールと区別する
    scoreCell('td', hole.holedOut ? String(hole.strokes) : `${hole.strokes}*`),
    scoreCell('td', i18n.formatDiff(hole.strokes - hole.par), 'diff'),
  );
  return row;
}


function scoreTotalRow(current: Round): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'total';
  row.append(
    scoreCell('th', t().colTotal),
    scoreCell('td', String(current.totalPar)),
    scoreCell('td', String(current.totalStrokes)),
    scoreCell('td', i18n.formatDiff(current.toPar), 'diff'),
  );
  return row;
}

