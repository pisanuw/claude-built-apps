import { clip } from './html';
import type { RiskyClaim } from './types';

/**
 * Wording that Google's Misrepresentation policy names or that reviewers
 * commonly treat as a red flag. Finding one is not a violation: it is a
 * sentence the owner should be able to back up, or soften.
 */
export interface ClaimRule {
  id: string;
  label: string;
  pattern: RegExp;
  why: string;
  fix: string;
}

export const CLAIM_RULES: ClaimRule[] = [
  {
    id: 'authorized',
    label: '“Official” or “authorized” seller',
    pattern: /\b(official|authori[sz]ed)\s+(store|shop|online store|retailer|reseller|dealer|distributor|seller|site|website|partner|stockist)\b/i,
    why: 'Calling yourself an official or authorized seller of a brand is something Google asks you to be able to prove.',
    fix: 'Keep it only if the brand lists you as authorized and you can show it. Otherwise remove the word.',
  },
  {
    id: 'guaranteed-results',
    label: 'Guaranteed results',
    pattern: /\bguaranteed\s+(results|weight loss|to work|to grow|growth|income)\b|\bresults\s+guaranteed\b|\b100%\s+(guaranteed|effective|safe)\b/i,
    why: 'Promises of guaranteed results are a common reason reviewers call a store misleading.',
    fix: 'Describe what the product does and what customers have reported, without a guarantee of the outcome.',
  },
  {
    id: 'health',
    label: 'Health or medical claim',
    pattern: /\b(cures?|treats?|prevents?|heals?|reverses?)\s+(cancer|diabetes|covid|anxiety|depression|arthritis|disease|infections?|hair loss|acne|insomnia)\b|\bfda[- ](approved|certified)\b|\bclinically\s+(proven|tested)\b|\bdoctor[- ]recommended\b/i,
    why: 'Medical and “clinically proven” claims need evidence, and Google treats unsupported ones as misrepresentation.',
    fix: 'Remove the claim, or link to the study or certificate that supports it.',
  },
  {
    id: 'lowest-price',
    label: 'Lowest-price promise',
    pattern: /\b(lowest\s+prices?\s+(guaranteed|anywhere|online|in the world|ever)|best\s+price\s+guarantee(d)?|cheapest\s+(anywhere|online|in the world))\b/i,
    why: 'A lowest-price promise invites a reviewer to check it.',
    fix: 'Keep it only if you have a written price-match policy on the site; otherwise say “great prices” or remove it.',
  },
  {
    id: 'huge-discount',
    label: 'Very large discount',
    pattern: /\b(up to\s+)?(8\d|9\d)\s?%\s+off\b/i,
    why: 'Discounts of 80% or more look like a fake “was” price unless the original price was really charged.',
    fix: 'Show the discount only if the item really sold at the higher price recently.',
  },
  {
    id: 'as-seen-on',
    label: '“As seen on” claim',
    pattern: /\bas\s+(seen|featured)\s+(on|in)\s+(tv|shark tank|dragons['’]? den|oprah|forbes|cnn|bbc|good morning america|the today show|vogue|the new york times)\b/i,
    why: 'Media mentions you cannot show are a known misrepresentation trigger.',
    fix: 'Link to the article or clip, or remove the badge.',
  },
  {
    id: 'just-pay-shipping',
    label: '“Free, just pay shipping”',
    pattern: /\bfree\b[^.]{0,40}\bjust\s+pay\s+(?:for\s+)?(?:the\s+)?shipping\b/i,
    why: 'Google lists “free” offers with hidden costs as a misrepresentation example.',
    fix: 'State the full price including shipping, or drop the word “free”.',
  },
  {
    id: 'fake-urgency',
    label: 'Countdown or stock-pressure wording',
    pattern: /\bonly\s+\d+\s+left\s+in\s+stock\b|\b\d+\s+(people|others|shoppers)\s+(are\s+)?(viewing|looking at|watching)\s+this\b|\boffer\s+ends\s+in\s+\d+\s*(?:minutes|min|hours)\b/i,
    why: 'Pressure messages from apps (“12 people are viewing this”) read as invented if they are not real counts.',
    fix: 'Turn the message off in the app unless it shows real numbers.',
  },
];

export function findRiskyClaims(sentences: string[]): RiskyClaim[] {
  const out: RiskyClaim[] = [];
  for (const rule of CLAIM_RULES) {
    for (const s of sentences) {
      const m = rule.pattern.exec(s);
      if (m) {
        out.push({ ruleId: rule.id, phrase: m[0], text: clip(s) });
        break;
      }
    }
  }
  return out;
}
