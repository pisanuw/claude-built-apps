// Guide tab: syntax cheat sheet, how the pipeline works, and how to use the
// project as a multi-week assignment.

export const GUIDE_HTML = `
<div class="guide">
  <section>
    <h2>What this is</h2>
    <p>A from-scratch layout engine for a subset of Mermaid flowchart syntax. Nothing here calls Mermaid, dagre or ELK: the parser, the five-step Sugiyama pipeline, the edge router and the SVG writer are about 3,000 lines of TypeScript that run in your browser. Type in the <strong>Editor</strong>, compare two versions in <strong>Diff</strong>, step through each stage in <strong>Pipeline</strong>, and score layout choices in <strong>Benchmark</strong>.</p>
  </section>

  <section>
    <h2>Syntax cheat sheet</h2>
    <div class="cheat">
      <div>
        <h3>Header and direction</h3>
        <pre tabindex="0" role="region" aria-label="Header and direction syntax">flowchart TD   %% TB, TD, BT, LR, RL
graph LR</pre>
        <h3>Node shapes</h3>
        <pre tabindex="0" role="region" aria-label="Node shapes syntax">A[Rectangle]     B(Rounded)
C([Stadium])     D[[Subroutine]]
E[(Database)]    F((Circle))
G(((Double)))    H>Flag]
I{Diamond}       J{{Hexagon}}
K[/Lean right/]  L[\\Lean left\\]
M[/Trapezoid\\]   N[\\Inverted/]
O["Quoted (any) text"]
P[Two<br>lines]</pre>
      </div>
      <div>
        <h3>Links</h3>
        <pre tabindex="0" role="region" aria-label="Links syntax">A --> B     arrow
A --- B     open
A -.-> B    dotted
A ==> B     thick
A ~~~ B     invisible (layout only)
A --o B     circle head
A --x B     cross head
A <--> B    both ends
A ---> B    one extra layer
A -->|yes| B   label
A -- yes --> B label
A --> B --> C  chain
A & B --> C    groups</pre>
      </div>
      <div>
        <h3>Subgraphs</h3>
        <pre tabindex="0" role="region" aria-label="Subgraphs syntax">subgraph api [API tier]
  direction LR
  a --> b
end
client --> api   %% edge to the box</pre>
        <h3>Styling</h3>
        <pre tabindex="0" role="region" aria-label="Styling syntax">classDef hot fill:#fee,stroke:#c00
class A,B hot
C:::hot
style D fill:#eef,stroke-width:2px
linkStyle 0,2 stroke:#c00
linkStyle default stroke:#888</pre>
        <p class="hint">Comments start with <code>%%</code>. <code>click</code> lines are accepted and ignored.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>How the layout works</h2>
    <ol class="steps">
      <li><strong>Parse.</strong> A hand-written recursive-descent parser reads one statement at a time and stops at the first error with its line and column, a short explanation and a hint.</li>
      <li><strong>Subgraphs first.</strong> Each subgraph is laid out on its own, in its own direction, then shrinks to one box in its parent. Edges are laid out in the lowest subgraph that contains both ends.</li>
      <li><strong>Cycle removal.</strong> A greedy feedback arc set (Eades, Lin and Smyth) or a DFS reverses a few edges so the graph is acyclic; they are drawn the right way round at the end.</li>
      <li><strong>Layering.</strong> Longest path, or network simplex (Gansner et al.), which minimises the total edge span exactly. Labelled edges get an extra layer for the label.</li>
      <li><strong>Dummy nodes.</strong> Edges longer than one layer are split so every edge joins adjacent layers.</li>
      <li><strong>Crossing minimisation.</strong> Median or barycenter sweeps plus adjacent transposition, scored by an O(E log V) accumulator-tree crossing count; the best order is kept.</li>
      <li><strong>Coordinates.</strong> Brandes-Koepf (four alignments, balanced) or the priority method, with separation that differs for nodes and dummies.</li>
      <li><strong>Routing.</strong> Splines with tangents along the flow, polylines, or orthogonal routes with spread-out tracks; legs from subgraph borders to inner nodes bend around siblings.</li>
      <li><strong>SVG.</strong> Every colour is a CSS custom property, so themes and dark mode restyle a diagram without laying it out again.</li>
    </ol>
  </section>

  <section>
    <h2>As a class assignment</h2>
    <p>The original idea is a five-week project; this site is a reference solution and a test harness for it.</p>
    <table class="weeks">
      <tbody>
        <tr><th>Week 1</th><td>Parser and AST with line/column errors. Compare messages with the Editor here.</td></tr>
        <tr><th>Week 2</th><td>Cycle removal and layering (longest path, then network simplex). The Pipeline tab shows both layerings and their total span.</td></tr>
        <tr><th>Week 3</th><td>Crossing minimisation with a crossing counter as the score. Step through the sweeps on the Pipeline tab.</td></tr>
        <tr><th>Week 4</th><td>Coordinates, text measurement, edge routing, subgraphs with their own direction.</td></tr>
        <tr><th>Week 5</th><td>Theming and a stable-layout diff. Then run the Benchmark and try to beat the default configuration.</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Limitations</h2>
    <ul>
      <li>Only flowcharts, and only the syntax above: no Markdown labels, icons, <code>@{ shape: ... }</code> metadata or click handlers.</li>
      <li>Subgraphs are laid out bottom-up as fixed boxes, so the parent cannot interleave a subgraph's nodes with outside ones. A heavily connected subgraph can end up wider than dagre or ELK would draw it.</li>
      <li>Crossings are counted on the layer graph of each scope; legs into subgraphs and self-loops are not included in that count.</li>
      <li>Text is measured with the browser's canvas for the current theme font; exported SVG opened on a machine with different fonts can look slightly tighter or looser.</li>
    </ul>
  </section>
</div>`;
