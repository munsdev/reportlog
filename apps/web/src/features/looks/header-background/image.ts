/**
 * Scaling a picture down before it is sent: the longest side to 1600 px,
 * re-encoded as a JPEG at 82% (the mock-up's numbers). A phone's photo is
 * several megabytes; a header never needs more than this, and the server
 * re-encodes whatever arrives again.
 */
export const HEADER_IMAGE_SIDE = 1600;
export const HEADER_IMAGE_QUALITY = 0.82;

/** The size an image is scaled to, never larger than it is. */
export function scaledSize(
  width: number,
  height: number,
  side = HEADER_IMAGE_SIDE,
): { width: number; height: number } {
  const k = Math.min(1, side / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Decode a chosen file, draw it at 1600 px, and give back the JPEG. Throws a sentence. */
export async function downscaleToJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read. Try another one.');
  }
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot scale the image.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', HEADER_IMAGE_QUALITY);
  });
  if (!blob) throw new Error('This browser cannot scale the image.');
  return blob;
}
