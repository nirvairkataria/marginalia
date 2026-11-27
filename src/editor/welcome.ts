/** Starter content inserted into the very first note. */
const demoGraph = JSON.stringify({
  exprs: [
    { id: 'w1', latex: 'y=a\\sin(bx)', color: '#c74440' },
    { id: 'w2', latex: 'a=2', color: '#2d70b3', slider: { min: -5, max: 5, step: 0 } },
    { id: 'w3', latex: 'b=1', color: '#388c46', slider: { min: 0, max: 4, step: 0 } },
    { id: 'w4', latex: 'x^2+y^2<9', color: '#6042a6' },
    { id: 'w5', latex: '(a,b)', color: '#fa7e19' },
  ],
  view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 },
  degrees: false,
  grid: true,
  showList: true,
}).replace(/"/g, '&quot;')

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
<h2>Graphs</h2>
<p>Type <code>/graph</code> for a Desmos-style graph. Drag the sliders, drag the orange point, or click the red curve to see its roots and extrema.</p>
<div data-type="graph" data-height="360" data-state="${demoGraph}"></div>
<h2>Code</h2>
<pre><code class="language-python">import numpy as np

signal = np.sin(2 * np.pi * 5 * np.linspace(0, 1, 500))
spectrum = np.fft.rfft(signal)
print(np.argmax(np.abs(spectrum)))  # 5</code></pre>
<h2>Roadmap</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>Rich text, Markdown shortcuts, LaTeX, code blocks you can run</p></li>
  <li data-type="taskItem" data-checked="true"><p>Ink: write anywhere on the page, or in canvas blocks that text wraps around</p></li>
  <li data-type="taskItem" data-checked="true"><p>Desmos-style graphs</p></li>
  <li data-type="taskItem" data-checked="false"><p>PDF and Markdown export, publishing to a website, sync and a mobile viewer</p></li>
</ul>
`
