import html2canvas from 'html2canvas';

/** Resolve the white form card (.wf-form) for image capture — not the outer page padding. */
export function getWithdrawFormCaptureEl(ref) {
  const root = ref?.current;
  if (!root) return null;
  if (root.classList?.contains('wf-form')) return root;
  return root.querySelector('.wf-form') || root;
}

export async function captureWithdrawFormCanvas(ref) {
  const el = getWithdrawFormCaptureEl(ref);
  if (!el) return null;
  return html2canvas(el, {
    useCORS: true,
    scale: 2,
    logging: false,
    backgroundColor: '#ffffff',
  });
}

export async function copyWithdrawFormImageToClipboard(ref) {
  const canvas = await captureWithdrawFormCanvas(ref);
  if (!canvas) return false;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}
