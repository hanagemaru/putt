/**
 * バックグラウンド復帰時の AudioContext 復旧をまとめる。
 *
 * iOS Safari は他アプリへの切り替えやブラウザを閉じる操作で、AudioContext を
 * 仕様外の 'interrupted' にする。'suspended' のときだけ resume していると
 * この状態から永久に戻らず、以降の再生が全て無音になる。
 * ここでは 'running' 以外を一律で復帰対象として扱う。
 */

/** resume 後も時計が進まない context を「復帰不能」と見なすまでの観測時間。 */
const LIVENESS_PROBE_MS = 250;

/** running へ戻せたら true。closed や resume 拒否なら false。 */
export async function resumeContext(context: AudioContext): Promise<boolean> {
  if (isClosed(context)) return false;
  if (!isRunning(context)) {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }
  return isRunning(context);
}

/**
 * running を名乗りながら音が出ない context を検出する。
 * iOS では中断明けに state だけ running へ戻り、時計が止まったままになることがある。
 * まだ suspended / interrupted のものは「次のユーザー操作で戻る余地がある」ため false を返す。
 */
export async function isContextDead(context: AudioContext): Promise<boolean> {
  if (isClosed(context)) return true;
  if (!isRunning(context)) return false;

  const before = context.currentTime;
  await wait(LIVENESS_PROBE_MS);
  if (isClosed(context)) return true;
  return isRunning(context) && context.currentTime <= before;
}

/** 作り直す前に古い context を手放す。iOS の同時生成数の上限に触れないようにする。 */
export function discardContext(context: AudioContext | null): void {
  if (!context || isClosed(context)) return;
  void context.close().catch(() => undefined);
}

function isRunning(context: AudioContext): boolean {
  return context.state === 'running';
}

function isClosed(context: AudioContext): boolean {
  return context.state === 'closed';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
