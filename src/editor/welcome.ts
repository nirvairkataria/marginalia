/** Starter content inserted into the very first note. */
export const WELCOME_HTML = `
<h1>Welcome to Marginalia</h1>
<p>Marginalia is for scientific and mathematical notes. You type with <strong>Markdown shortcuts</strong>, but what you see is always the formatted result. Nothing here is plain Markdown underneath.</p>
<h2>Try the shortcuts</h2>
<ul>
  <li><p>Type <code>## </code> at the start of a line for a heading, <code>- </code> for a list, <code>&gt; </code> for a quote, <code>[] </code> for a checklist.</p></li>
  <li><p>Wrap text in <code>**double stars**</code> for <strong>bold</strong>, <code>*stars*</code> for <em>italic</em>, <code>\`backticks\`</code> for <code>code</code>.</p></li>
  <li><p>Wrap LaTeX in dollar signs for inline math: Euler's identity <span data-type="inline-math" data-latex="e^{i\\pi} + 1 = 0"></span> stays in the sentence.</p></li>
  <li><p>Type <code>$$</code> and press Enter for a display equation. Type <code>\`\`\`python</code> and press Enter for a code block.</p></li>
  <li><p>Type <code>/</code> anywhere for the full block menu.</p></li>
</ul>
<p>Made a shortcut by accident? Press <strong>Backspace</strong> right away to turn it back into the characters you typed.</p>
<h2>Math</h2>
<p>Click any equation to edit it visually, or edit the raw LaTeX underneath.</p>
<div data-type="block-math" data-latex="\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi i x \\xi}\\, dx"></div>
<h2>Code</h2>
<pre><code class="language-python">import numpy as np

signal = np.sin(2 * np.pi * 5 * np.linspace(0, 1, 500))
spectrum = np.fft.rfft(signal)
print(np.argmax(np.abs(spectrum)))  # 5</code></pre>
<h2>Coming next</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>Rich text, Markdown shortcuts, LaTeX, code blocks</p></li>
  <li data-type="taskItem" data-checked="false"><p>Canvas blocks: draw with your pen while text wraps around them</p></li>
  <li data-type="taskItem" data-checked="false"><p>Ink overlay: annotate anywhere on the page</p></li>
  <li data-type="taskItem" data-checked="false"><p>Graphs (Desmos), PDF and Markdown export, sync and a mobile viewer</p></li>
</ul>
`
