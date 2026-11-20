import DOMPurify from 'dompurify';

// Defense in depth: the backend (lib/sanitize.ts) is the authoritative gate
// on what a message's `content` can contain, but rendering someone else's
// message via dangerouslySetInnerHTML is exactly where a payload that ever
// slipped past that gate (a bug, a future write path that forgets to
// sanitize) would actually execute — so this is a second, independent check
// at the point of highest consequence, not a redundant no-op.
//
// P2: mirrors the backend's rich-text set — marks (bold, italic, underline,
// strike, inline code, links), blocks (paragraphs, headings 1–3, lists,
// quotes, code blocks) and text alignment.
const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 's', 'br', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3'];
const ALLOWED_ATTR = ['style', 'href', 'target', 'rel', 'class'];
// Links may only be web or e-mail addresses.
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:)/i;
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const CODE_CLASS = /^language-[a-z0-9+#-]{1,30}$/;

let hooked = false;
const ensureHooks = () => {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (!el.getAttribute) return;
    // Keep only a valid text-align from any style attribute.
    const style = el.getAttribute('style');
    if (style !== null) {
      const match = /(?:^|;)\s*text-align\s*:\s*([a-z]+)\s*(?:;|$)/i.exec(style);
      const align = match?.[1]?.toLowerCase();
      if (align && ALIGNMENTS.has(align) && /^(P|H1|H2|H3)$/.test(el.tagName)) el.setAttribute('style', `text-align: ${align}`);
      else el.removeAttribute('style');
    }
    // Classes only as code-block language hints.
    const cls = el.getAttribute('class');
    if (cls !== null && !(el.tagName === 'CODE' && CODE_CLASS.test(cls))) el.removeAttribute('class');
    // Links always open safely in a new tab.
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    } else {
      el.removeAttribute('target');
      el.removeAttribute('rel');
    }
  });
};

// QA L10: web addresses written as plain text (sent right after typing them,
// before the editor's auto-link ran) become links when shown. Only http(s),
// never inside an existing link or code; trailing punctuation stays text.
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi;

const linkify = (root: DocumentFragment) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  for (const text of texts) {
    if (text.parentElement?.closest('a, code, pre')) continue;
    const value = text.nodeValue ?? '';
    const matches = [...value.matchAll(URL_IN_TEXT)];
    if (matches.length === 0) continue;
    const out = document.createDocumentFragment();
    let last = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      if (start > last) out.appendChild(document.createTextNode(value.slice(last, start)));
      const link = document.createElement('a');
      link.setAttribute('href', match[0]);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer nofollow');
      link.textContent = match[0];
      out.appendChild(link);
      last = start + match[0].length;
    }
    if (last < value.length) out.appendChild(document.createTextNode(value.slice(last)));
    text.replaceWith(out);
  }
};

export const sanitizeMessageHtml = (dirty: string): string => {
  ensureHooks();
  const fragment = DOMPurify.sanitize(dirty, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP, RETURN_DOM_FRAGMENT: true });
  linkify(fragment);
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
};
