/** Compiled out of production; enables a sample result only in preview builds. */
export const resultPreview = import.meta.env.VITE_RESULT_PREVIEW === 'true'
  && new URLSearchParams(location.search).get('resultPreview') === '1';
