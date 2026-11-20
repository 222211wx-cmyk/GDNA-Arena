/**
 * Post-publish content control. Nobody is blocked before publishing; the
 * upload is checked automatically once the server has verified the media.
 */
export const MIN_CONTENT_SECONDS = 30;

export type ContentCheck =
  | { status: "accepté"; reason: "" }
  | { status: "refusé"; reason: string };

const TRIVIAL_TITLES = new Set([
  "test", "tests", "essai", "video", "vidéo", "clip", "aaa", "azerty", "qwerty",
  "asdf", "hello", "salut", "تجربة", "فيديو", "كليب", "تست",
]);

export function checkContent(input: { title: string; durationSec: number | null }): ContentCheck {
  const title = input.title.trim();
  const letters = [...title].filter(c => /[\p{L}]/u.test(c));
  const refuse = (reason: string): ContentCheck => ({ status: "refusé", reason });

  if (input.durationSec !== null && input.durationSec < MIN_CONTENT_SECONDS) {
    return refuse(`Trop court — ${MIN_CONTENT_SECONDS} secondes minimum / قصير بزاف، 30 ثانية أو أكثر`);
  }
  if (letters.length < 3 || new Set(letters.map(c => c.toLowerCase())).size < 2 ||
      TRIVIAL_TITLES.has(title.toLowerCase())) {
    return refuse("Contenu trivial — donnez un vrai titre / محتوى تافه، دير عنوان حقيقي");
  }
  return { status: "accepté", reason: "" };
}
