// Normalise un libellé produit pour pouvoir grouper les variantes :
// "Coca-Cola 1 L" / "COCA COLA 1L" / "  coca cola 1 l " → "coca cola 1l"

export function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")     // accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")        // ponctuation → espace
    .replace(/\s+/g, " ")                // espaces multiples → 1
    .trim();
}

// SHA-256 d'un Blob/File (pour détecter les doublons stricts).
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(hashBuf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}
