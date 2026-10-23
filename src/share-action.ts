/** One result-share action. Sharing is user-initiated; no upload or auto-posting. */
export function bindResultShare(
  button: HTMLButtonElement,
  data: { text: string; url: string },
  image: Promise<File>,
  language: 'ja' | 'en',
): () => void {
  const ja = language === 'ja';
  let alive = true;
  let file: File | null = null;
  let imageUrl: string | null = null;
  let dialog: HTMLDialogElement | null = null;
  const message = `${data.text}\n${data.url}`;
  button.disabled = true;
  const showManualShare = () => {
    dialog?.close();
    dialog = document.createElement('dialog');
    Object.assign(dialog.style, { width: 'min(520px, 90vw)', maxHeight: '85vh', overflow: 'auto', padding: '20px', background: '#151b18', color: '#edf6e9', border: '2px solid #a5c5ac', boxSizing: 'border-box' });
    dialog.setAttribute('aria-label', ja ? '結果をシェア' : 'Share result');
    const note = document.createElement('p');
    note.textContent = file
      ? ja ? 'このブラウザでは画像と文章をまとめて共有できません。画像は長押し・右クリックで保存、文章は選択してコピーできます。' : 'This browser cannot share an image and text together. Save the image with a long press or right-click, and select the text to copy.'
      : ja ? '画像を作成できませんでした。結果の文章を選択してコピーできます。' : 'Image unavailable. Select the result text to copy.';
    dialog.append(note);
    if (imageUrl) {
      const preview = document.createElement('img');
      preview.src = imageUrl;
      preview.alt = ja ? '結果のスコア画像' : 'Result score image';
      preview.style.width = '100%';
      preview.style.height = 'auto';
      dialog.append(preview);
    }
    const text = document.createElement('textarea');
    text.readOnly = true;
    text.value = message;
    text.rows = 5;
    text.setAttribute('aria-label', ja ? '共有する文章' : 'Share text');
    Object.assign(text.style, { width: '100%', boxSizing: 'border-box', margin: '12px 0', font: 'inherit' });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = ja ? '閉じる' : 'Close';
    Object.assign(close.style, { display: 'block', minHeight: '44px', padding: '8px 20px', font: 'inherit' });
    const shown = dialog;
    close.onclick = () => shown.close();
    shown.addEventListener('close', () => { shown.remove(); if (dialog === shown) dialog = null; });
    shown.append(text, close);
    document.body.append(shown);
    shown.showModal();
  };
  void image.then(value => {
    if (!alive) return;
    file = value;
    imageUrl = URL.createObjectURL(value);
    button.disabled = false;
  }).catch(() => { if (alive) button.disabled = false; });
  button.onclick = () => {
    let supported = false;
    try { supported = !!file && !!navigator.share && !!navigator.canShare?.({ files: [file] }); } catch { /* Show manual sharing. */ }
    if (!supported || !file) { showManualShare(); return; }
    button.disabled = true;
    try {
      // No await before share: preserves transient activation on iOS.
      void navigator.share({ files: [file], text: message }).catch(error => {
        if (alive && error?.name !== 'AbortError') showManualShare();
      }).finally(() => { if (alive) button.disabled = false; });
    } catch { button.disabled = false; showManualShare(); }
  };
  return () => {
    alive = false;
    button.onclick = null;
    dialog?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  };
}
