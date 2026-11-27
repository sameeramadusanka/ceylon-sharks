// Shared checks for images uploaded from the admin panel (Player of the Week posters, site photos).

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** File extension from the image's magic bytes; null if it isn't a JPEG or PNG. */
export function imageExtension(bytes: Buffer): 'jpg' | 'png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}
