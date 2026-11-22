# Lewis Structure Alt Text from the command line

`lewis-alt-text.mjs` writes alt text for images of Lewis structures and related
chemistry figures, using the same rules and checks as the web app at
[lewis-alt-text.hintwise.org](https://lewis-alt-text.hintwise.org). It is
worth using when you have many images: give it a whole folder and it does them
one after another.

You do not need to know how to program. You type a few commands into a
terminal window, and this page shows every one of them.

**Only have a few images?** The [web app](https://lewis-alt-text.hintwise.org)
is easier: drop an image in, copy the alt text out.

---

## 1. Install Node.js (once)

The tool runs on Node.js, a free program.

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version for
   your computer.
2. Open the downloaded installer and accept the defaults.

To check that it worked, open a terminal (step 3 shows how) and type:

```
node --version
```

You should see a version number such as `v24.11.0`. If you see
"command not found" or "not recognized", close the terminal window, open a new
one and try again. A terminal that was already open before you installed Node
does not know about it yet.

## 2. Download the tool

Open [lewis-alt-text.hintwise.org/terminal/](https://lewis-alt-text.hintwise.org/terminal/)
and click **Download lewis-alt-text.mjs**. Your browser saves it in your
**Downloads** folder.

It is one file. You do not have to unzip or install anything else. Don't
double-click it, because it does nothing that way: you run it from a terminal.

## 3. Open a terminal in your Downloads folder

**Mac:** press Command+Space, type `Terminal` and press Return.
**Windows:** open the Start menu, type `Terminal` (or `PowerShell`) and press
Enter.
**Linux:** open your Terminal app.

Then type this and press Enter (Return on a Mac):

```
cd Downloads
```

Check that the tool is there:

```
node lewis-alt-text.mjs --version
```

You should see something like `lewis-alt-text 0.1.0 (built 2026-11-22)`.

> If your browser saved the file under another name, such as
> `lewis-alt-text (1).mjs`, use that name in quotes:
> `node "lewis-alt-text (1).mjs" --version`. The tool works under any name. Its
> own help shows the commands with the name you used.

## 4. Sign in (once per computer)

The tool uses your free daily HintWise allowance, the same one as the web
app, so it needs to know who you are. Type:

```
node lewis-alt-text.mjs login
```

It waits for a code. To get one:

1. Open [lewis-alt-text.hintwise.org/terminal/](https://lewis-alt-text.hintwise.org/terminal/)
   in your browser.
2. Enter your email address and click **Email me a link for my terminal**.
3. Open the link in the email HintWise sends you. The page shows a code.
4. Click **Copy code**, go back to the terminal, paste it (Command+V on a Mac,
   Ctrl+V or right-click on Windows) and press Enter.

You see `Signed in as you@example.edu`. You don't have to do this again on
this computer. If you skip this step, the tool walks you through it the first
time you give it an image.

## 5. Write alt text

For one image:

```
node lewis-alt-text.mjs figure.png
```

The alt text is printed in the terminal. Select it and copy it.

**Tip: you don't have to type a file's location.** Type
`node lewis-alt-text.mjs ` (with a space at the end), then drag the image from
a Finder or File Explorer window into the terminal. Its full path appears.
Then press Enter.

For every image in a folder:

```
node lewis-alt-text.mjs "Chem 101 figures"
```

Put quotes around any file or folder name that has spaces in it. The tool
reads PNG, JPEG, GIF and WebP images. On a Mac it also converts HEIC (iPhone
photos), TIFF and BMP files for you.

### Tell it about the figure (better results)

Add any of these after the image name:

| Option | What it means | Values |
|---|---|---|
| `--purpose` | Is the figure a question or an answer key? | `question` (students must work it out; nothing is given away) or `answer-key` (everything shown is described) |
| `--focus` | What the lesson is about | `lewis`, `resonance`, `formal-charge`, `geometry`, `polarity`, `other` |
| `--context` | Caption, question text or lesson topic | any text, **in quotes** |

Example:

```
node lewis-alt-text.mjs figure.png --purpose question --focus geometry --context "HW 3, question 2: predict the shape"
```

Without `--purpose`, a figure is treated as a question, so the alt text gives
nothing away.

### Save the alt text to a file

Add `> filename` at the end:

```
node lewis-alt-text.mjs "Chem 101 figures" > alt-text.txt
```

The file `alt-text.txt` is saved in the same folder (Downloads), with a
heading line for each image. Warnings and notes still appear in the terminal.

## 6. Read what it tells you

- **The alt text** is the paragraph it prints. **Always compare it with the
  image before you publish it.** The model can miscount lines, dots or charges,
  especially in crowded or blurry figures.
- **`warning:`** lines point out places where the alt text may break the
  skill's rules, such as a bond named "double" or "Cl" written without a space.
  Fix them by hand, or run it again.
- **`QUESTION:`** means the model needs to know something first. Answer it with
  `--context "..."` and run the same command again.
- **`--audit`** also prints the atom-by-atom count the alt text was built from,
  which makes a miscount easy to spot.
- **`note:`** lines say what the tool did, such as shrinking a large image so
  it could be sent.

## 7. Everyday commands

| To | Type |
|---|---|
| See how many alt texts you have left today | `node lewis-alt-text.mjs status` |
| See all the options | `node lewis-alt-text.mjs --help` |
| See which version you have | `node lewis-alt-text.mjs --version` |
| Sign this computer out | `node lewis-alt-text.mjs logout` |

When your daily allowance runs out, the tool says when it renews. In the
meantime you can use the web app with your own Anthropic API key, or use
`--local` (next section).

## 8. Using your own Claude subscription instead (optional)

If you have [Claude Code](https://claude.com/claude-code) installed and signed
in, add `--local`. Then the tool uses your Claude subscription instead of the
HintWise allowance, and you don't need to sign in to HintWise:

```
node lewis-alt-text.mjs figure.png --local
```

`--model sonnet` or `--model haiku` picks a faster model than the default,
Opus.

---

## When something goes wrong

| You see | What to do |
|---|---|
| `command not found: node` or `'node' is not recognized` | Node.js is not installed, or the terminal was opened before you installed it. Do step 1, then open a new terminal window. |
| `Cannot find module ... lewis-alt-text.mjs` | The terminal is in a different folder from the file. Type `cd Downloads` (step 3), or check the file's name: `ls` on a Mac or Linux, `dir` on Windows. |
| `lewis-alt-text needs a newer Node.js` | Install the current LTS version from [nodejs.org](https://nodejs.org) over the old one. |
| `no such file` | Check the spelling, put quotes around names with spaces, or drag the file into the terminal instead of typing its name. |
| `no such file, and not a command` | A typo in `login`, `status` or `logout`, or the image name is wrong. |
| `hint: ... put the whole context in quotes` | Your `--context` text has spaces but no quotes around it. |
| `That code has expired or was already used` | Each code works once and only for a short time. Ask for a new link on the terminal page. |
| `This computer is not signed in` | Run `node lewis-alt-text.mjs login` (step 4). |
| `the image is ... kB, and the live app takes up to 680 kB` | Crop the image or save it smaller, or drop it into the web app, which shrinks images for you. On a Mac, the tool shrinks them itself. |
| `not a PNG, JPEG, GIF or WebP image` | Open the image and save or export it as PNG. |
| `macOS did not let this terminal read it` | Open System Settings > Privacy & Security > Files and Folders and allow Terminal to read that folder, or move the image to another folder. |
| `Could not reach HintWise` | Check the internet connection. Some school or company networks block it; try another network. |
| Double-clicking the file does nothing, or opens it in an editor | That is expected. Run it from a terminal (steps 3 to 5). |
| `Unknown option` | Check the spelling of the option. `--help` lists them all. |

Still stuck? Run the command again with `--version` and send what you see.

## Updating

The tool does not update itself. If it stops working, or the web app has
something it lacks, download it again from the terminal page and replace the
old file. You stay signed in.

## What is stored, and where

- **Your images** go only to the model, through HintWise, or through Claude
  Code with `--local`. Nothing about your figures is saved on a server.
- **Your sign-in** is saved on your computer in
  `.config/lewis-alt-text/session.json` inside your home folder, in a file only
  your account can read. Treat it like a password. `logout` deletes it.
- **To delete your HintWise account and data**, sign in to the web app, open
  your name at the top right and choose **Delete my account**.

## For scripts

`--json` prints one JSON object per image. Exit status: `0` alt text written,
`2` the model asked a question, `1` an error. Set `LEWIS_MODEL` to choose the
model, and `CLAUDE_BIN` to point `--local` at a `claude` program that is not on
your PATH.
