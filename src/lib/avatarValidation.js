import sharp from 'sharp';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 16_000_000;

const IMAGE_TYPES = [
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    matches: buffer =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  {
    mime: 'image/png',
    extension: 'png',
    matches: buffer =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ),
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    matches: buffer =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/gif',
    extension: 'gif',
    matches: buffer => {
      const signature = buffer.subarray(0, 6).toString('ascii');
      return signature === 'GIF87a' || signature === 'GIF89a';
    },
  },
];

export async function validateAvatarFile(file) {
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return { error: 'Archivo no válido.' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { error: 'La imagen está vacía.' };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: 'La imagen no debe superar 2MB.' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = IMAGE_TYPES.find(type => type.matches(buffer));
  if (!detected) {
    return { error: 'El archivo no contiene una imagen JPG, PNG, WEBP o GIF válida.' };
  }

  const declaredType = String(file.type || '').toLowerCase();
  if (declaredType && declaredType !== detected.mime) {
    return { error: 'El tipo declarado no coincide con el contenido de la imagen.' };
  }

  try {
    const image = sharp(buffer, {
      limitInputPixels: MAX_AVATAR_PIXELS,
      pages: 1,
    });
    const metadata = await image.metadata();
    if (metadata.format !== detected.extension &&
        !(metadata.format === 'jpeg' && detected.extension === 'jpg')) {
      return { error: 'El formato interno de la imagen no es válido.' };
    }
    if (!metadata.width || !metadata.height) {
      return { error: 'No se pudieron verificar las dimensiones de la imagen.' };
    }

    const sanitized = await image
      .autoOrient()
      .resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();

    return {
      buffer: sanitized,
      extension: 'webp',
      mime: 'image/webp',
    };
  } catch {
    return { error: 'No se pudo decodificar la imagen de forma segura.' };
  }
}
