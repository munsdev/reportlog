# The embeddable figures widget

`stats-widget.html` is a self-contained block: one `<div>`, one `<style>`,
one `<script>`. Paste it into a Webflow Embed element, a WordPress custom
HTML block, or any page that takes raw markup. No build step, no library,
no external fonts.

It reads `https://reports.example.org/api/v1/stats` and renders the whole
response — dispositions, veracity, who filed, subject, states,
corroboration — styled to match the site.

## Two things that are easy to get wrong

**Every class is prefixed `el-`.** The widget lands on somebody else's
page, and an unprefixed `.card` or `.row` will collide with theirs sooner
or later.

**Colour and font-family are set on the headings themselves**, not only on
the wrapper. A host page that styles its own `h2` beats anything inherited
from an ancestor, and the widget then quietly takes on that site's look —
which was exactly what happened the first time this was tested against a
page with its own heading styles.

## Changing it

Edit `stats-widget.html`, then regenerate the copy embedded in the public
documentation page:

    node -e "const fs=require('fs');const w=fs.readFileSync('tools/embed/stats-widget.html','utf8');const e=w.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');let p=fs.readFileSync('public/api.html','utf8');const s=p.indexOf('<pre><code>',p.indexOf('A widget you can paste'));const n=p.indexOf('</code></pre>',s);fs.writeFileSync('public/api.html',p.slice(0,s+11)+e+p.slice(n));"

The browser suite checks the two are in step, so a forgotten regeneration
fails the build rather than shipping a stale snippet for people to paste.
