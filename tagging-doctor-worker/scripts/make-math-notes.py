"""Writes fixtures/math-notes (AC-65): a 20-to-30-page set of lecture notes with
displayed and aligned equations, titlesec, inputenc and fontenc, two TikZ
pictures and two raster figures. Run once; the output is committed.

    python3 scripts/make-math-notes.py
"""
import math
import os
import random

import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'fixtures', 'math-notes')
random.seed(7)

TOPICS = [
    ('Limits and continuity', 'f(x)', 'x \\to a'),
    ('The derivative', "f'(x)", 'h \\to 0'),
    ('Rules of differentiation', '(fg)\'', 'x \\to 0'),
    ('Applications of the derivative', 'f(x)', 'x \\to \\infty'),
    ('The definite integral', '\\int_a^b f', 'n \\to \\infty'),
    ('Techniques of integration', '\\int u\\,dv', 'x \\to 1'),
    ('Sequences and series', 'a_n', 'n \\to \\infty'),
    ('Power series', '\\sum c_n x^n', '|x| \\to R'),
]

PARA = (
    'In this section we study {t} with care. We begin with the intuition, then state the '
    'definitions precisely, and finally prove the main results. Throughout, the reader should '
    'keep in mind the geometric picture: a function is a rule, and {e} describes how that rule '
    'behaves as ${lim}$. Students often find it useful to work through the examples before reading '
    'the proofs, and to return to the proofs once the examples feel familiar. '
)

def equations(i):
    k = i + 2
    return [
        '\\begin{equation}\n  \\lim_{x \\to %d} \\frac{x^{%d} - %d^{%d}}{x - %d} = %d \\cdot %d^{%d}\n  \\label{eq:lim%d}\n\\end{equation}'
        % (k, k, k, k, k, k, k, k - 1, i),
        '\\begin{align}\n  \\int_0^{%d} x^{%d}\\,dx &= \\left[ \\frac{x^{%d}}{%d} \\right]_0^{%d} \\\\\n'
        '  &= \\frac{%d^{%d}}{%d} \\label{eq:int%d}\n\\end{align}' % (k, k, k + 1, k + 1, k, k, k + 1, k + 1, i),
        '\\[\n  \\sum_{n=1}^{\\infty} \\frac{1}{n^{%d}} \\le 1 + \\int_1^{\\infty} \\frac{dx}{x^{%d}} = 1 + \\frac{1}{%d}\n\\]'
        % (k, k, k - 1),
        '\\begin{align*}\n  (f \\circ g)\'(x) &= f\'(g(x))\\, g\'(x), \\\\\n'
        '  \\frac{d}{dx} \\sin(%d x) &= %d \\cos(%d x), \\\\\n  \\frac{d}{dx} e^{%d x} &= %d e^{%d x}.\n\\end{align*}'
        % (k, k, k, k, k, k),
    ]

def section(i, topic):
    t, e, lim = topic
    out = ['\\section{%s}' % t]
    for j in range(3):
        out.append('\\subsection{%s, part %d}' % (t, j + 1))
        out.append(PARA.format(t=t.lower(), e='$' + e + '$', lim=lim) * 2)
        out.append(equations(i)[j % 4])
        out.append('\\begin{theorem}\nIf $f$ is continuous on $[a,b]$ and differentiable on $(a,b)$, then there is '
                   'a point $c \\in (a,b)$ with $f\'(c) = \\frac{f(b)-f(a)}{b-a}$, as in \\eqref{eq:lim%d}.\n\\end{theorem}' % i)
        out.append('\\begin{proof}\nApply Rolle\'s theorem to $g(x) = f(x) - \\frac{f(b)-f(a)}{b-a}(x-a)$, which satisfies '
                   '$g(a) = g(b)$. Then $g\'(c) = 0$ for some $c$, and the claim follows.\n\\end{proof}')
        out.append(PARA.format(t=t.lower(), e='$' + e + '$', lim=lim))
        out.append(equations(i)[(j + 1) % 4])
        out.append('\\begin{itemize}\n  \\item Compute the limit for $k = %d$.\n  \\item Check the answer numerically.\n'
                   '  \\item Explain why the result is plausible.\n\\end{itemize}' % (i + j))
    return '\n\n'.join(out)

TIKZ_1 = r'''\begin{figure}[ht]
  \centering
  \begin{tikzpicture}[scale=1.2]
    \draw[->] (-0.5,0) -- (4.2,0) node[right] {$x$};
    \draw[->] (0,-0.5) -- (0,3.2) node[above] {$y$};
    \draw[thick,domain=0:4,smooth,variable=\x] plot ({\x},{0.18*\x*\x});
    \draw[dashed] (1,0.18) -- (3,1.62);
    \fill (1,0.18) circle (1.5pt) node[above left] {$a$};
    \fill (3,1.62) circle (1.5pt) node[above left] {$b$};
  \end{tikzpicture}
  \caption{A secant line between $a$ and $b$.}
\end{figure}'''

TIKZ_2 = r'''\begin{figure}[ht]
  \centering
  \begin{tikzpicture}[scale=1.1]
    \draw[->] (-0.3,0) -- (5.2,0) node[right] {$x$};
    \draw[->] (0,-0.3) -- (0,2.6) node[above] {$y$};
    \foreach \i in {0,...,9} {
      \pgfmathsetmacro{\x}{0.5*\i}
      \pgfmathsetmacro{\h}{2.2*exp(-0.3*\x)}
      \draw[fill=gray!30] (\x,0) rectangle ++(0.5,\h);
    }
    \draw[thick,domain=0:5,smooth,variable=\x] plot ({\x},{2.2*exp(-0.3*\x)});
  \end{tikzpicture}
  \caption{A Riemann sum with ten rectangles.}
\end{figure}'''

def raster(name, dots):
    """A 640x400 plot drawn into a PPM, then turned into PNG or JPEG by ImageMagick."""
    w, h = 640, 400
    px = bytearray(b'\xff' * (w * h * 3))

    def put(x, y, c, r=2):
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h:
                    i = (yy * w + xx) * 3
                    px[i:i + 3] = bytes(c)

    for x in range(40, 620):
        put(x, 360, (0, 0, 0), 1)
    for y in range(20, 360):
        put(40, y, (0, 0, 0), 1)
    for x in range(0, 580):
        y = 360 - int(150 + 120 * math.sin(x / 60.0) * math.exp(-x / 400.0))
        put(40 + x, y, (30, 80, 160), 2)
    for _ in range(dots):
        put(random.randint(50, 610), random.randint(40, 350), (200, 60, 40), 3)
    ppm = os.path.join(OUT, 'figures', name + '.ppm')
    with open(ppm, 'wb') as f:
        f.write(b'P6 %d %d 255\n' % (w, h) + bytes(px))
    subprocess.run(['convert', ppm, '-strip', os.path.join(OUT, 'figures', name)], check=True)
    os.remove(ppm)

def main():
    os.makedirs(os.path.join(OUT, 'figures'), exist_ok=True)
    raster('damped.png', 0)
    raster('scatter.jpg', 40)
    body = []
    for i, topic in enumerate(TOPICS):
        body.append(section(i, topic))
        if i == 1:
            body.append(TIKZ_1)
        if i == 2:
            body.append('\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.7\\textwidth]{figures/damped.png}\n'
                        '  \\caption{A damped oscillation.}\n\\end{figure}')
        if i == 4:
            body.append(TIKZ_2)
        if i == 6:
            body.append('\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.7\\textwidth]{figures/scatter.jpg}\n'
                        '  \\caption{Measured values around a curve.}\n\\end{figure}')
    doc = r'''\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{titlesec}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}

\titleformat{\section}{\Large\bfseries}{\thesection.}{0.6em}{}
\titleformat{\subsection}{\large\bfseries}{\thesubsection}{0.6em}{}
\newtheorem{theorem}{Theorem}[section]

\title{Calculus I: Lecture Notes}
\author{Course staff}
\date{Fall term}

\begin{document}
\maketitle
\tableofcontents

''' + '\n\n'.join(body) + '\n\n\\end{document}\n'
    with open(os.path.join(OUT, 'main.tex'), 'w') as f:
        f.write(doc)

if __name__ == '__main__':
    main()
