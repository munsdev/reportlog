import { describe, expect, it } from 'vitest';
import { inline, renderMarkdown, slug } from '../src/markdown.ts';

describe('inline', () => {
  it('leaves code alone and escapes it', () => {
    expect(inline('run `releases/<id>` and **stop**')).toBe(
      'run <code>releases/&lt;id&gt;</code> and <strong>stop</strong>',
    );
  });

  it('does not read snake_case or globs as emphasis', () => {
    expect(inline('the reportlog_job and reportlog-*')).toBe('the reportlog_job and reportlog-*');
    expect(inline('it is _sealed_ here')).toBe('it is <em>sealed</em> here');
  });

  it('rewrites links through the option', () => {
    expect(inline('[x](../a.md)', { rewriteLink: (h) => `/r/${h}` })).toBe(
      '<a href="/r/../a.md">x</a>',
    );
  });
});

describe('renderMarkdown', () => {
  it('makes GitHub-style heading anchors, unique on a page', () => {
    const { html, headings } = renderMarkdown(
      '## Rolling back\n\n### Why rolling back is safe\n\n## Rolling back',
    );
    expect(headings.map((h) => h.id)).toEqual([
      'rolling-back',
      'why-rolling-back-is-safe',
      'rolling-back-1',
    ]);
    expect(html).toContain('<h2 id="rolling-back">');
    expect(slug('Email (Scaleway)')).toBe('email-scaleway');
  });

  it('keeps a code block inside a numbered step', () => {
    const { html } = renderMarkdown(
      '3. **Install.**\n\n   ```sh\n   sudo ./install.sh\n   ```\n\n   It asks.\n4. **Next.**',
    );
    expect(html).toBe(
      '<ol start="3"><li><p><strong>Install.</strong></p>\n<pre><code class="language-sh">sudo ./install.sh</code></pre>\n<p>It asks.</p></li><li><strong>Next.</strong></li></ol>',
    );
  });

  it('reads a wrapped list item as one item', () => {
    const { html } = renderMarkdown('- one\n  still one\n- two');
    expect(html).toBe('<ul><li>one\nstill one</li><li>two</li></ul>');
  });

  it('splits table cells on pipes outside code only', () => {
    const { html } = renderMarkdown('| a | b |\n| --- | --- |\n| `x|y` | z |');
    expect(html).toContain('<td><code>x|y</code></td><td>z</td>');
  });

  it('renders a block quote', () => {
    expect(renderMarkdown('> **Note** this').html).toBe(
      '<blockquote><p><strong>Note</strong> this</p></blockquote>',
    );
  });
});
