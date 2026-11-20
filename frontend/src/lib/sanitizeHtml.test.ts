import { describe, expect, it } from 'vitest';
import { sanitizeMessageHtml } from './sanitizeHtml';

const parse = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = sanitizeMessageHtml(html);
  return host;
};

describe('sanitizeMessageHtml (rich text render guard)', () => {
  it('keeps every format the composer can produce', () => {
    const html =
      '<h2 style="text-align: center">Title</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>x</code></p>' +
      '<ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><blockquote><p>q</p></blockquote>' +
      '<pre><code class="language-ts">const a = 1;</code></pre><p><a href="https://example.com">link</a></p>';
    const host = parse(html);
    for (const tag of ['h2', 'strong', 'em', 'u', 's', 'code', 'ul', 'ol', 'li', 'blockquote', 'pre', 'a']) {
      expect(host.querySelector(tag), tag).not.toBeNull();
    }
    expect(host.querySelector('h2')?.getAttribute('style')).toBe('text-align: center');
    expect(host.querySelector('pre code')?.getAttribute('class')).toBe('language-ts');
  });

  it('forces links to open safely in a new tab', () => {
    const a = parse('<a href="https://example.com" target="_self" rel="opener">x</a>').querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('drops scriptable and protocol-relative links', () => {
    expect(parse('<a href="javascript:alert(1)">x</a>').querySelector('a')?.getAttribute('href') ?? null).toBeNull();
    expect(parse('<a href="data:text/html,x">x</a>').querySelector('a')?.getAttribute('href') ?? null).toBeNull();
    expect(parse('<a href="//evil.example">x</a>').querySelector('a')?.getAttribute('href') ?? null).toBeNull();
    expect(parse('<a href="mailto:a@b.co">x</a>').querySelector('a')?.getAttribute('href')).toBe('mailto:a@b.co');
  });

  it('removes scripts, images, handlers and arbitrary styling', () => {
    const host = parse(
      '<p style="color:red;text-align:right" onclick="x()">t</p><img src=x onerror=alert(1)><script>alert(1)</script>' +
        '<span class="evil">s</span><code class="evil">c</code><ul style="text-align:center"><li>l</li></ul>'
    );
    expect(host.querySelector('img, script, span')).toBeNull();
    expect(host.querySelector('p')?.getAttribute('style')).toBe('text-align: right');
    expect(host.querySelector('p')?.hasAttribute('onclick')).toBe(false);
    expect(host.querySelector('code')?.hasAttribute('class')).toBe(false);
    expect(host.querySelector('ul')?.hasAttribute('style')).toBe(false);
  });
});

describe('QA L10 — plain-text web addresses become safe links', () => {
  it('links http(s) addresses in text, keeps trailing punctuation as text', () => {
    const html = sanitizeMessageHtml('<p>see https://example.com/a?b=1, and http://x.io.</p>');
    const div = document.createElement('div');
    div.innerHTML = html;
    const links = [...div.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a?b=1', 'http://x.io']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    }
    expect(div.textContent).toBe('see https://example.com/a?b=1, and http://x.io.');
  });

  it('never links inside existing links or code, and never non-web schemes', () => {
    const div = document.createElement('div');
    div.innerHTML = sanitizeMessageHtml('<p><a href="https://a.com">https://a.com</a> <code>https://b.com</code> javascript:alert(1) ftp://c.com</p>');
    expect(div.querySelectorAll('a')).toHaveLength(1);
    expect(div.querySelector('code a')).toBeNull();
    expect(div.innerHTML).not.toMatch(/href="javascript|href="ftp/);
  });

  it('cannot be used to inject markup through a crafted address', () => {
    const div = document.createElement('div');
    div.innerHTML = sanitizeMessageHtml('<p>https://x.io/"onmouseover="alert(1) &lt;img src=x onerror=alert(2)&gt;</p>');
    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('[onmouseover]')).toBeNull();
    expect(div.querySelector('a')?.getAttribute('href')).toBe('https://x.io/');
  });
});
