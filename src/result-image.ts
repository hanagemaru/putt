import { CONFIG } from './config';
import type { HoleScore } from './round';
import type { Language } from './i18n';
import type { ShareResult } from './result-share';

/** Draw a dedicated score card, without uploading scores or capturing private UI. */
export async function createResultImage(result: ShareResult, scores: readonly HoleScore[], lang: Language): Promise<File> {
  const L = CONFIG.shareImage;
  const canvas = document.createElement('canvas');
  canvas.width = L.width;
  canvas.height = L.height;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--pixel-font').trim() || 'sans-serif';
  try { await document.fonts.load(`${L.labelSize}px ${family}`, 'Putt 0123456789 9ホール 合計打数 このスコアを超えられる？ ギブアップあり'); } catch { /* System-font fallback. */ }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.fillStyle = '#101c14';
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.strokeStyle = '#85cf62';
  ctx.lineWidth = 4;
  ctx.strokeRect(L.padding / 2, L.padding / 2, L.width - L.padding, L.height - L.padding);
  const text = (value: string, x: number, y: number, size: number, color = '#edf6e9', align: CanvasTextAlign = 'left') => {
    ctx.fillStyle = color;
    ctx.font = `${size}px ${family}`;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };
  text('Putt', L.padding, L.headerY, L.titleSize, '#a5de7f');
  text(result.tourName, L.padding, L.courseY, L.courseSize);
  text(String(result.totalStrokes), L.padding, L.scoreY, L.scoreSize);
  const diff = result.totalStrokes - result.totalPar;
  const relative = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff);
  text(`${relative}  /  PAR ${result.totalPar}`, L.width - L.padding, L.scoreY, L.titleSize, '#a5de7f', 'right');
  text(lang === 'ja' ? '9ホール 合計打数' : '9 HOLES · TOTAL STROKES', L.padding, L.labelY, L.labelSize);
  const cellWidth = (L.width - 2 * L.padding) / scores.length;
  scores.forEach((hole, index) => {
    const x = L.padding + cellWidth * (index + 0.5);
    ctx.fillStyle = index % 2 ? '#243d2b' : '#1b3022';
    ctx.fillRect(L.padding + cellWidth * index, L.tableY - L.cellHeight / 2, cellWidth, L.cellHeight);
    text(`H${hole.number}`, x, L.tableY - L.smallSize / 2, L.smallSize, '#abc5a6', 'center');
    text(`${hole.strokes}${hole.holedOut ? '' : '*'}`, x, L.tableY + L.cellSize, L.cellSize, '#edf6e9', 'center');
  });
  text(result.gaveUp
    ? lang === 'ja' ? '* ギブアップあり' : '* Includes a conceded hole'
    : '', L.padding, L.footerY, L.labelSize);
  text('putt.hanage.app', L.padding, L.urlY, L.courseSize, '#a5de7f');
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/png'));
  return new File([blob], 'putt-score.png', { type: 'image/png' });
}
