# The status report and the decision card

## When nothing changed: one line

```
12:35 Nothing to report.
```

The time is `TZ=<report tz> date '+%H:%M'`, read just before sending. Send it with `SendUserMessage`, and nothing else: no file, no caption, no time zone, no context figure, and no other text in the turn. It is the whole message.

## The status report (`status-report.md` in the scratchpad)

Sent only when something changed since the last check. Rewrite the whole file each time. Send it with `SendUserFile` (`status: proactive`) and a one-line caption naming what is new and anything waiting for the owner.

```markdown
# <Project> status: <Day D Mon>, <HH:MM TZ> (<report time zone's place name>)

## What's new
- The changes since the last report, most important first. A merge names the
  PR and what it does; a deploy names the commit and how it was verified;
  a failure names the job and what you did about it.

## Waiting for you
**Decision: <question> (sent <time>).** The options, numbered; the
recommendation and why; what happens with no answer.

**Action: <what>.** Why it is needed now, then:

    <the exact copy-paste command>

and what a working run prints.

(Or: "Nothing open.")

## Defaults taken
- <the decision>: took <the recommendation> at <time> with no answer; to
  undo, <how>. (Kept until the owner acknowledges it; leave the section out
  when it is empty.)

## In flight
- #<PR>: <title>, CI <state>.
- Branches ready for a PR, or parked, and why.

## Next up
- The next items, and dated tasks with their times.

## Implemented, by day (<report time zone>)
**<Day D Mon>**
- <HH:MM>: #<PR>, <what it did>. Deployed, if it was.

**<the day before>**
- ...
```

The rules behind it:

- **Every time comes from `date`**, converted to the report time zone. A planned send time is not a timestamp.
- **"Waiting for you" is complete every time.** Repeat every open decision in full, never "see the 10:00 card", until it is answered or its default is taken.
- **No back references anywhere.** Not to an earlier card, report, message or note, and not for the exact wording of a change: put the wording itself in. Each item stands alone.
- **The card's text comes last.** If the reply that sends the report or card also prints its text, the text is the last thing in the reply, whenever possible.
- **An owner action appears only once it can be done now**, with a command that runs as pasted: no `#` comments inside it (zsh reads them as arguments), and no secret on the command line (`read -rs` it first). If only a dashboard can do it, give its exact URL and the field to change.
- **Say what is not verified.** "Deployed" means the deploy log and the health check were read, not that the deploy was started.
- **Keep it short:** the owner reads it on a phone.

## The decision card

A separate small file, one per decision, sent when the decision arises (not saved for the next status check). It is self-contained: the owner can act on it without any earlier message, so it carries the exact text, links and commands itself, never "as in my earlier note". When the reply also prints it, it comes last.

```markdown
# Decision: <question> (sent <Day D Mon>, <HH:MM TZ>)

<Two or three sentences of context: what you found, with numbers.>

## Options
| | What | Cost / risk |
|---|---|---|
| **A** | ... | ... |
| B | ... | ... |

## Recommendation: A
<Why, in two sentences.>

## Questions (answer by number)
1. ...
2. ...

With no answer in 15 minutes I'll <the default>, and say so in the next message
with how to undo it. <Or: "Nothing happens by default: this waits for your yes."
for anything that writes production data, spends money, deploys unasked,
deletes the unrestorable, rotates secrets, rewrites shared history or
publishes outside the session.>
```

If later work changes the recommendation (a review found a flaw, a measurement changed the picture), send a revised card that says it replaces the earlier one and why.
