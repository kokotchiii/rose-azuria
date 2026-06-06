// Compression d'image avant upload, pour rester sous les limites de l'API
// Anthropic (~5 Mo / image). Utilise un canvas du DOM (process renderer Electron).
//
// - PDF             : passe-plat (Anthropic accepte les PDF jusqu'à 32 Mo)
// - HEIC/HEIF       : passe-plat — la conversion est faite côté Edge Function
// - Image < 1 Mo    : passe-plat (ça vaut pas le coup de recompresser)
// - Sinon           : redimensionne max 1600 px + recompression JPEG q=0.85

export async function compressImage(
  file: File,
  maxDim = 1600,
  quality = 0.85,
): Promise<File> {
  if (file.type === "application/pdf") return file;

  const lower = file.name.toLowerCase();
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    lower.endsWith(".heic") ||
    lower.endsWith(".heif");

  // HEIC : pas supporté (limite serveur). On bloque côté client avec un message clair.
  if (isHeic) {
    throw new Error(
      "Les photos HEIC iPhone ne sont pas supportées. Active 'Le plus compatible' dans Réglages iPhone → Appareil photo → Formats, puis reprends la photo. Ou utilise une capture d'écran.",
    );
  }

  if (file.size < 1_000_000) return file;

  const img = await loadImage(file);
  const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob_failed"))),
      "image/jpeg",
      quality,
    ),
  );

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}
