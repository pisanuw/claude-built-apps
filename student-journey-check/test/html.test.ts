import { describe, expect, it } from 'vitest';
import { decodeEntities, excerpt, findLessonLinks, readPage, snippet } from '../src/core/html';

describe('page text', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('&amp; &#8217; &#x2019; &euro; &bogus; &#0;')).toBe('& ’ ’ € &bogus; &#0;');
  });
  it('drops scripts, styles and the head from the visible text', () => {
    expect(readPage('<html><head><title>T</title><style>p{}</style></head><body><p>One</p><script>x()</script><p>Two</p></body></html>').text).toBe('One Two');
  });
  it('cuts snippets and excerpts with ellipses', () => {
    expect(snippet('a'.repeat(50) + 'NEEDLE' + 'b'.repeat(50), /NEEDLE/, 5)).toBe('…aaaaaNEEDLEbbbbb…');
    expect(snippet('abc', /z/)).toBeUndefined();
    expect(excerpt('x'.repeat(10), 4)).toBe('xxxx…');
  });
  it('ignores broken lesson links', () => {
    expect(findLessonLinks(readPage('<a href="http://[bad/lesson/x/">x</a>'), 'https://a.com/')).toEqual([]);
  });
});
