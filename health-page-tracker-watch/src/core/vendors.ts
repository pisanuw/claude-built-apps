/**
 * The vendor table: the outside tools that most often turn up on small
 * health and wellness practice websites, what each one receives, and what
 * its maker publicly says about signing a Business Associate Agreement (BAA).
 *
 * It is kept by hand. Matching is plain host and path rules, so the same
 * recording always gives the same answer. When we are not sure what a
 * vendor offers, the status is 'ask' rather than a guess.
 */

/** When the table was last reviewed. Shown on every report. */
export const TABLE_REVIEWED = '2026-11';

/**
 * offers: says it signs a BAA with healthcare customers.
 * some-plans: signs one only on certain plans, tiers or add-ons.
 * no: its own terms say it does not sign one for this product, or tell sites not to send health information.
 * ask: not confirmed in this table; ask the vendor in writing.
 */
export type BaaStatus = 'offers' | 'some-plans' | 'no' | 'ask';

export type Kind =
  | 'advertising'
  | 'analytics'
  | 'session-recording'
  | 'tag-manager'
  | 'chat'
  | 'accessibility'
  | 'booking'
  | 'forms'
  | 'practice-platform'
  | 'email-marketing'
  | 'call-tracking'
  | 'reviews'
  | 'video'
  | 'maps'
  | 'fonts'
  | 'code-library'
  | 'spam-protection'
  | 'payments'
  | 'website-platform'
  | 'social-embed';

export interface Vendor {
  id: string;
  name: string;
  /** Company that runs it, for the "ask them" line. */
  company: string;
  kind: Kind;
  baa: BaaStatus;
  /** One plain sentence on the vendor's own position, as of TABLE_REVIEWED. */
  baaNote: string;
}

export interface KindInfo {
  label: string;
  /** What this kind of tool receives beyond the basics every outside request carries. */
  receives: string;
  /**
   * high: sees what the visitor does or types, or ties the visit to a profile.
   * low: mostly serves a file, so it sees the visit but little else.
   */
  weight: 'high' | 'low';
  /** Options for the practice's web person, never a legal conclusion. */
  options: string;
}

export const KINDS: Record<Kind, KindInfo> = {
  advertising: {
    label: 'Advertising pixel',
    receives: 'Which pages the visitor opened and what they clicked or submitted, matched to their profile on the ad platform so it can target and measure ads.',
    weight: 'high',
    options: 'Stop it from loading on booking, intake and service pages (in Google Tag Manager, add an exception trigger for those pages), or remove it from the site. If you need ad conversion counts, some tracking vendors that sign a BAA can pass on a count without the page details.',
  },
  analytics: {
    label: 'Visitor analytics',
    receives: 'Every page the visitor opens, how they arrived, and their clicks, kept as a visitor history.',
    weight: 'high',
    options: 'Turn it off on booking, intake and service pages, or move to an analytics tool whose maker signs a BAA, or one hosted on your own server.',
  },
  'session-recording': {
    label: 'Session recording and heatmaps',
    receives: 'A replay of the visit: mouse movement, clicks, scrolling and, unless masked, what the visitor types into fields.',
    weight: 'high',
    options: 'Turn off recording on booking, intake and service pages. Recordings can capture what people type before they press Send.',
  },
  'tag-manager': {
    label: 'Tag loader',
    receives: 'The visit itself. Its real effect is the other tools it loads, which are listed separately in this report.',
    weight: 'low',
    options: 'Fine on its own. Use it to control where the other tools load: add an exception trigger so pixels and analytics skip your health pages.',
  },
  chat: {
    label: 'Chat widget',
    receives: 'The page the visitor is on, plus everything they type into the chat, which on a practice site is often health details.',
    weight: 'high',
    options: 'Hide the chat on booking, intake and service pages, or switch to a chat tool whose maker signs a BAA. Either way, add a line asking visitors not to share health details in chat.',
  },
  accessibility: {
    label: 'Accessibility widget',
    receives: 'The page address, IP address and device details on every page it runs on (one vendor confirmed this in writing in 2026).',
    weight: 'high',
    options: 'Ask the vendor in writing what it receives and whether it will sign a BAA. If it will not, consider fixing accessibility in the site itself instead of using a widget.',
  },
  booking: {
    label: 'Online booking',
    receives: 'Everything the visitor enters to book: name, contact details, the service or reason for the visit, and the time.',
    weight: 'high',
    options: 'Confirm your plan includes a signed BAA. If it does not, use the booking built into a practice-management system that signs one.',
  },
  forms: {
    label: 'Online forms',
    receives: 'Everything typed into the form, which on an intake form is health information.',
    weight: 'high',
    options: 'Confirm your plan includes a signed BAA and that the form has the vendor’s HIPAA setting turned on. If not, move intake forms into a system that signs one.',
  },
  'practice-platform': {
    label: 'Practice-management system',
    receives: 'Client records, bookings and forms, by design.',
    weight: 'high',
    options: 'This is the kind of tool that is built for health data. Keep the signed BAA with your records.',
  },
  'email-marketing': {
    label: 'Email marketing',
    receives: 'Who opened which pages, tied to their email address once they sign up or click a newsletter link.',
    weight: 'high',
    options: 'Keep its tracking script off booking, intake and service pages; a plain sign-up form on your home page is lower risk than site-wide tracking.',
  },
  'call-tracking': {
    label: 'Call tracking',
    receives: 'Which pages the visitor saw before calling, the caller’s number and, on some plans, call recordings.',
    weight: 'high',
    options: 'Confirm your plan includes the vendor’s HIPAA option and a signed BAA, or show your normal phone number on health pages.',
  },
  reviews: {
    label: 'Reviews and messaging',
    receives: 'The visit, plus anything the visitor types into a review or text-us box.',
    weight: 'high',
    options: 'Confirm whether the vendor signs a BAA for your plan. If not, keep its widget off booking and service pages.',
  },
  video: {
    label: 'Video player',
    receives: 'The visit, and the video platform can set its own cookies and link the view to a logged-in account.',
    weight: 'low',
    options: 'Use the platform’s privacy-enhanced mode, or show a still image that loads the video only when clicked.',
  },
  maps: {
    label: 'Map',
    receives: 'The visit, from the moment the page loads, even if the visitor never touches the map.',
    weight: 'low',
    options: 'Replace the live map on health pages with a picture of the map that links to directions.',
  },
  fonts: {
    label: 'Web fonts',
    receives: 'The visitor’s IP address and the site they are on.',
    weight: 'low',
    options: 'Host the font files on your own site (most themes and font plugins have a setting for this). It is usually a ten-minute change.',
  },
  'code-library': {
    label: 'Shared code library',
    receives: 'The visitor’s IP address and the site they are on.',
    weight: 'low',
    options: 'Serve the file from your own site instead of a shared public server.',
  },
  'spam-protection': {
    label: 'Spam protection',
    receives: 'How the visitor uses the page (mouse and timing), to tell people from bots.',
    weight: 'low',
    options: 'Load it only on pages with a form, or use spam protection that runs on your own server.',
  },
  payments: {
    label: 'Payments',
    receives: 'Card details and the amount, sent directly to the payment company.',
    weight: 'low',
    options: 'Payments have their own rules. Keep the description on the payment generic (say “Session”, not the condition) and ask your lawyer if you are unsure.',
  },
  'website-platform': {
    label: 'Website platform',
    receives: 'Every visit to your site, since it hosts it.',
    weight: 'low',
    options: 'Ask the platform whether it signs a BAA. Many website builders do not, which is one reason practices keep intake and booking in a separate system that does.',
  },
  'social-embed': {
    label: 'Social media embed',
    receives: 'The visit, often linked to the visitor’s logged-in social account.',
    weight: 'high',
    options: 'Replace the live feed or button on health pages with a plain link to your profile.',
  },
};

interface HostRule {
  vendor: string;
  /** Host equals this or ends with "." + this. */
  host: string;
  /** Optional path prefix the URL must start with. */
  path?: string;
}

const NO_AD = 'Ad platforms do not sign BAAs for their pixels, and their terms tell sites not to send health information.';
const NO_GOOGLE = 'Google’s BAA covers some Workspace and Cloud services only; this product is not one of them.';
const ASK = 'Not confirmed in this table. Ask the vendor in writing whether it will sign a BAA for this product.';

const V = (id: string, name: string, company: string, kind: Kind, baa: BaaStatus, baaNote: string): Vendor => ({ id, name, company, kind, baa, baaNote });

export const VENDORS: Record<string, Vendor> = Object.fromEntries(
  [
    // Advertising
    V('meta-pixel', 'Meta Pixel (Facebook / Instagram)', 'Meta', 'advertising', 'no', NO_AD),
    V('google-ads', 'Google Ads / DoubleClick', 'Google', 'advertising', 'no', NO_GOOGLE),
    V('tiktok-pixel', 'TikTok Pixel', 'TikTok', 'advertising', 'no', NO_AD),
    V('linkedin-insight', 'LinkedIn Insight Tag', 'LinkedIn', 'advertising', 'no', NO_AD),
    V('pinterest-tag', 'Pinterest Tag', 'Pinterest', 'advertising', 'no', NO_AD),
    V('snap-pixel', 'Snap Pixel', 'Snap', 'advertising', 'no', NO_AD),
    V('x-pixel', 'X (Twitter) Pixel', 'X', 'advertising', 'no', NO_AD),
    V('microsoft-ads', 'Microsoft Ads (Bing UET)', 'Microsoft', 'advertising', 'no', NO_AD),
    V('reddit-pixel', 'Reddit Pixel', 'Reddit', 'advertising', 'no', NO_AD),
    // Analytics and recording
    V('google-analytics', 'Google Analytics', 'Google', 'analytics', 'no', 'Google says not to send health information to Analytics, and its BAA does not cover Analytics.'),
    V('cloudflare-analytics', 'Cloudflare Web Analytics', 'Cloudflare', 'analytics', 'some-plans', 'Cloudflare offers a BAA on its Enterprise plans only.'),
    V('jetpack-stats', 'Jetpack Stats (WordPress.com)', 'Automattic', 'analytics', 'ask', ASK),
    V('mixpanel', 'Mixpanel', 'Mixpanel', 'analytics', 'some-plans', 'Mixpanel offers a BAA on its higher-tier plans only.'),
    V('segment', 'Segment', 'Twilio', 'analytics', 'some-plans', 'Twilio offers a BAA for Segment on its business plans only.'),
    V('freshpaint', 'Freshpaint', 'Freshpaint', 'analytics', 'offers', 'Freshpaint is built for healthcare marketing and signs BAAs.'),
    V('hotjar', 'Hotjar', 'Hotjar', 'session-recording', 'no', 'Hotjar says it does not sign BAAs and should not be used on pages with health information.'),
    V('clarity', 'Microsoft Clarity', 'Microsoft', 'session-recording', 'no', 'Clarity’s terms forbid sending health information and Microsoft does not sign a BAA for it.'),
    V('fullstory', 'FullStory', 'FullStory', 'session-recording', 'ask', ASK),
    V('lucky-orange', 'Lucky Orange', 'Lucky Orange', 'session-recording', 'ask', ASK),
    V('crazy-egg', 'Crazy Egg', 'Crazy Egg', 'session-recording', 'ask', ASK),
    V('mouseflow', 'Mouseflow', 'Mouseflow', 'session-recording', 'ask', ASK),
    V('gtm', 'Google Tag Manager / Google tag', 'Google', 'tag-manager', 'no', NO_GOOGLE),
    // Chat
    V('tawk', 'tawk.to chat', 'tawk.to', 'chat', 'ask', ASK),
    V('tidio', 'Tidio chat', 'Tidio', 'chat', 'ask', ASK),
    V('intercom', 'Intercom', 'Intercom', 'chat', 'some-plans', 'Intercom signs a BAA only on certain plans with its HIPAA option.'),
    V('drift', 'Drift', 'Salesloft', 'chat', 'ask', ASK),
    V('livechat', 'LiveChat', 'Text', 'chat', 'ask', ASK),
    V('zendesk', 'Zendesk chat', 'Zendesk', 'chat', 'some-plans', 'Zendesk signs a BAA only on certain plans with its advanced compliance add-on.'),
    V('crisp', 'Crisp chat', 'Crisp', 'chat', 'ask', ASK),
    // Accessibility widgets
    V('userway', 'UserWay', 'UserWay', 'accessibility', 'ask', ASK),
    V('accessibe', 'accessiBe', 'accessiBe', 'accessibility', 'ask', ASK),
    V('equalweb', 'EqualWeb', 'EqualWeb', 'accessibility', 'ask', ASK),
    V('audioeye', 'AudioEye', 'AudioEye', 'accessibility', 'ask', ASK),
    V('reciteme', 'Recite Me', 'Recite Me', 'accessibility', 'ask', ASK),
    // Booking, forms and practice systems
    V('jane', 'Jane', 'Jane Software', 'practice-platform', 'offers', 'Jane signs a BAA with US practices.'),
    V('simplepractice', 'SimplePractice', 'SimplePractice', 'practice-platform', 'offers', 'SimplePractice signs a BAA with its customers.'),
    V('therapynotes', 'TherapyNotes', 'TherapyNotes', 'practice-platform', 'offers', 'TherapyNotes signs a BAA with its customers.'),
    V('intakeq', 'IntakeQ / PracticeQ', 'IntakeQ', 'practice-platform', 'offers', 'IntakeQ signs a BAA with its customers.'),
    V('healthie', 'Healthie', 'Healthie', 'practice-platform', 'offers', 'Healthie signs a BAA with its customers.'),
    V('practice-better', 'Practice Better', 'Practice Better', 'practice-platform', 'some-plans', 'Practice Better offers a BAA; check that it covers your plan.'),
    V('zocdoc', 'Zocdoc', 'Zocdoc', 'booking', 'offers', 'Zocdoc signs a BAA with the providers it books for.'),
    V('acuity', 'Acuity Scheduling', 'Squarespace', 'booking', 'some-plans', 'Acuity signs a BAA only on its top plan with HIPAA features turned on.'),
    V('calendly', 'Calendly', 'Calendly', 'booking', 'ask', ASK),
    V('mindbody', 'Mindbody', 'Mindbody', 'booking', 'ask', ASK),
    V('vagaro', 'Vagaro', 'Vagaro', 'booking', 'ask', ASK),
    V('square-appointments', 'Square Appointments', 'Block', 'booking', 'ask', ASK),
    V('boulevard', 'Boulevard', 'Boulevard', 'booking', 'ask', ASK),
    V('jotform', 'Jotform', 'Jotform', 'forms', 'some-plans', 'Jotform signs a BAA only on plans with its HIPAA option turned on.'),
    V('formstack', 'Formstack', 'Formstack', 'forms', 'some-plans', 'Formstack signs a BAA only on its HIPAA-eligible plans.'),
    V('typeform', 'Typeform', 'Typeform', 'forms', 'ask', ASK),
    V('google-forms', 'Google Forms', 'Google', 'forms', 'some-plans', 'Google’s BAA can cover Forms inside a paid Workspace account; free Gmail accounts are not covered.'),
    // Marketing, calls, reviews
    V('hubspot', 'HubSpot', 'HubSpot', 'email-marketing', 'ask', ASK),
    V('mailchimp', 'Mailchimp', 'Intuit', 'email-marketing', 'no', 'Mailchimp’s terms tell customers not to send health information.'),
    V('klaviyo', 'Klaviyo', 'Klaviyo', 'email-marketing', 'ask', ASK),
    V('constant-contact', 'Constant Contact', 'Constant Contact', 'email-marketing', 'ask', ASK),
    V('callrail', 'CallRail', 'CallRail', 'call-tracking', 'some-plans', 'CallRail signs a BAA only with its HIPAA compliance add-on.'),
    V('podium', 'Podium', 'Podium', 'reviews', 'ask', ASK),
    V('birdeye', 'Birdeye', 'Birdeye', 'reviews', 'ask', ASK),
    V('weave', 'Weave', 'Weave', 'reviews', 'offers', 'Weave signs a BAA with healthcare practices.'),
    V('trustpilot', 'Trustpilot widget', 'Trustpilot', 'reviews', 'ask', ASK),
    V('elfsight', 'Elfsight widgets', 'Elfsight', 'social-embed', 'ask', ASK),
    // Media, files, platform
    V('youtube', 'YouTube video', 'Google', 'video', 'no', NO_GOOGLE),
    V('vimeo', 'Vimeo video', 'Vimeo', 'video', 'ask', ASK),
    V('wistia', 'Wistia video', 'Wistia', 'video', 'ask', ASK),
    V('google-maps', 'Google Maps', 'Google', 'maps', 'no', NO_GOOGLE),
    V('google-fonts', 'Google Fonts', 'Google', 'fonts', 'no', NO_GOOGLE),
    V('adobe-fonts', 'Adobe Fonts', 'Adobe', 'fonts', 'ask', ASK),
    V('font-awesome', 'Font Awesome', 'Fonticons', 'fonts', 'ask', ASK),
    V('google-hosted-libraries', 'Google Hosted Libraries', 'Google', 'code-library', 'no', NO_GOOGLE),
    V('cdnjs', 'cdnjs (Cloudflare)', 'Cloudflare', 'code-library', 'ask', 'A free public file server; there is no account, so there is no one to sign a BAA with.'),
    V('jsdelivr', 'jsDelivr', 'jsDelivr', 'code-library', 'ask', 'A free public file server; there is no account, so there is no one to sign a BAA with.'),
    V('unpkg', 'unpkg', 'unpkg', 'code-library', 'ask', 'A free public file server; there is no account, so there is no one to sign a BAA with.'),
    V('gravatar', 'Gravatar', 'Automattic', 'code-library', 'ask', ASK),
    V('recaptcha', 'Google reCAPTCHA', 'Google', 'spam-protection', 'no', NO_GOOGLE),
    V('hcaptcha', 'hCaptcha', 'Intuition Machines', 'spam-protection', 'ask', ASK),
    V('stripe', 'Stripe', 'Stripe', 'payments', 'ask', ASK),
    V('paypal', 'PayPal', 'PayPal', 'payments', 'ask', ASK),
    V('square-payments', 'Square payments', 'Block', 'payments', 'ask', ASK),
    V('squarespace', 'Squarespace', 'Squarespace', 'website-platform', 'ask', ASK),
    V('wix', 'Wix', 'Wix', 'website-platform', 'ask', ASK),
    V('instagram', 'Instagram embed', 'Meta', 'social-embed', 'no', NO_AD),
    V('facebook-embed', 'Facebook embed or button', 'Meta', 'social-embed', 'no', NO_AD),
  ].map((v) => [v.id, v]),
);

const HOST_RULES: HostRule[] = [
  { vendor: 'meta-pixel', host: 'connect.facebook.net' },
  { vendor: 'meta-pixel', host: 'facebook.com', path: '/tr' },
  { vendor: 'facebook-embed', host: 'facebook.com', path: '/plugins' },
  { vendor: 'google-ads', host: 'googleadservices.com' },
  { vendor: 'google-ads', host: 'doubleclick.net' },
  { vendor: 'google-ads', host: 'googlesyndication.com' },
  { vendor: 'google-ads', host: 'google.com', path: '/pagead' },
  { vendor: 'google-ads', host: 'google.com', path: '/ccm/collect' },
  { vendor: 'tiktok-pixel', host: 'analytics.tiktok.com' },
  { vendor: 'linkedin-insight', host: 'snap.licdn.com' },
  { vendor: 'linkedin-insight', host: 'px.ads.linkedin.com' },
  { vendor: 'pinterest-tag', host: 'ct.pinterest.com' },
  { vendor: 'pinterest-tag', host: 's.pinimg.com', path: '/ct/' },
  { vendor: 'snap-pixel', host: 'sc-static.net' },
  { vendor: 'snap-pixel', host: 'tr.snapchat.com' },
  { vendor: 'x-pixel', host: 'static.ads-twitter.com' },
  { vendor: 'x-pixel', host: 'ads-twitter.com' },
  { vendor: 'x-pixel', host: 'analytics.twitter.com' },
  { vendor: 'microsoft-ads', host: 'bat.bing.com' },
  { vendor: 'reddit-pixel', host: 'redditstatic.com', path: '/ads' },
  { vendor: 'reddit-pixel', host: 'alb.reddit.com' },
  { vendor: 'google-analytics', host: 'google-analytics.com' },
  { vendor: 'google-analytics', host: 'analytics.google.com' },
  { vendor: 'cloudflare-analytics', host: 'static.cloudflareinsights.com' },
  { vendor: 'cloudflare-analytics', host: 'cloudflareinsights.com' },
  { vendor: 'jetpack-stats', host: 'stats.wp.com' },
  { vendor: 'jetpack-stats', host: 'pixel.wp.com' },
  { vendor: 'mixpanel', host: 'mxpnl.com' },
  { vendor: 'mixpanel', host: 'mixpanel.com' },
  { vendor: 'segment', host: 'cdn.segment.com' },
  { vendor: 'segment', host: 'api.segment.io' },
  { vendor: 'freshpaint', host: 'freshpaint.io' },
  { vendor: 'hotjar', host: 'hotjar.com' },
  { vendor: 'hotjar', host: 'hotjar.io' },
  { vendor: 'clarity', host: 'clarity.ms' },
  { vendor: 'fullstory', host: 'fullstory.com' },
  { vendor: 'lucky-orange', host: 'luckyorange.com' },
  { vendor: 'lucky-orange', host: 'luckyorange.net' },
  { vendor: 'crazy-egg', host: 'crazyegg.com' },
  { vendor: 'mouseflow', host: 'mouseflow.com' },
  { vendor: 'gtm', host: 'googletagmanager.com' },
  { vendor: 'tawk', host: 'tawk.to' },
  { vendor: 'tidio', host: 'tidio.co' },
  { vendor: 'tidio', host: 'tidiochat.com' },
  { vendor: 'intercom', host: 'intercom.io' },
  { vendor: 'intercom', host: 'intercomcdn.com' },
  { vendor: 'drift', host: 'drift.com' },
  { vendor: 'drift', host: 'driftt.com' },
  { vendor: 'livechat', host: 'livechatinc.com' },
  { vendor: 'zendesk', host: 'zdassets.com' },
  { vendor: 'zendesk', host: 'zendesk.com' },
  { vendor: 'crisp', host: 'crisp.chat' },
  { vendor: 'userway', host: 'userway.org' },
  { vendor: 'accessibe', host: 'acsbapp.com' },
  { vendor: 'accessibe', host: 'accessibe.com' },
  { vendor: 'equalweb', host: 'equalweb.com' },
  { vendor: 'audioeye', host: 'audioeye.com' },
  { vendor: 'reciteme', host: 'reciteme.com' },
  { vendor: 'jane', host: 'janeapp.com' },
  { vendor: 'simplepractice', host: 'simplepractice.com' },
  { vendor: 'simplepractice', host: 'clientsecure.me' },
  { vendor: 'therapynotes', host: 'therapynotes.com' },
  { vendor: 'therapynotes', host: 'therapyportal.com' },
  { vendor: 'intakeq', host: 'intakeq.com' },
  { vendor: 'intakeq', host: 'practiceq.com' },
  { vendor: 'healthie', host: 'gethealthie.com' },
  { vendor: 'practice-better', host: 'practicebetter.io' },
  { vendor: 'zocdoc', host: 'zocdoc.com' },
  { vendor: 'acuity', host: 'acuityscheduling.com' },
  { vendor: 'acuity', host: 'as.me' },
  { vendor: 'calendly', host: 'calendly.com' },
  { vendor: 'mindbody', host: 'mindbodyonline.com' },
  { vendor: 'mindbody', host: 'healcode.com' },
  { vendor: 'vagaro', host: 'vagaro.com' },
  { vendor: 'square-appointments', host: 'book.squareup.com' },
  { vendor: 'square-appointments', host: 'square.site' },
  { vendor: 'boulevard', host: 'joinblvd.com' },
  { vendor: 'boulevard', host: 'blvd.co' },
  { vendor: 'jotform', host: 'jotform.com' },
  { vendor: 'jotform', host: 'jotfor.ms' },
  { vendor: 'formstack', host: 'formstack.com' },
  { vendor: 'typeform', host: 'typeform.com' },
  { vendor: 'google-forms', host: 'docs.google.com', path: '/forms' },
  { vendor: 'hubspot', host: 'hs-scripts.com' },
  { vendor: 'hubspot', host: 'hs-analytics.net' },
  { vendor: 'hubspot', host: 'hs-banner.com' },
  { vendor: 'hubspot', host: 'hsforms.net' },
  { vendor: 'hubspot', host: 'hubspot.com' },
  { vendor: 'mailchimp', host: 'chimpstatic.com' },
  { vendor: 'mailchimp', host: 'list-manage.com' },
  { vendor: 'klaviyo', host: 'klaviyo.com' },
  { vendor: 'constant-contact', host: 'ctctcdn.com' },
  { vendor: 'callrail', host: 'callrail.com' },
  { vendor: 'podium', host: 'podium.com' },
  { vendor: 'birdeye', host: 'birdeye.com' },
  { vendor: 'weave', host: 'getweave.com' },
  { vendor: 'trustpilot', host: 'trustpilot.com' },
  { vendor: 'elfsight', host: 'elfsight.com' },
  { vendor: 'elfsight', host: 'elfsightcdn.com' },
  { vendor: 'youtube', host: 'youtube.com' },
  { vendor: 'youtube', host: 'youtube-nocookie.com' },
  { vendor: 'youtube', host: 'ytimg.com' },
  { vendor: 'vimeo', host: 'vimeo.com' },
  { vendor: 'vimeo', host: 'vimeocdn.com' },
  { vendor: 'wistia', host: 'wistia.com' },
  { vendor: 'wistia', host: 'wistia.net' },
  { vendor: 'google-maps', host: 'maps.googleapis.com' },
  { vendor: 'google-maps', host: 'maps.gstatic.com' },
  { vendor: 'google-maps', host: 'google.com', path: '/maps' },
  { vendor: 'google-fonts', host: 'fonts.googleapis.com' },
  { vendor: 'google-fonts', host: 'fonts.gstatic.com' },
  { vendor: 'adobe-fonts', host: 'use.typekit.net' },
  { vendor: 'adobe-fonts', host: 'p.typekit.net' },
  { vendor: 'font-awesome', host: 'fontawesome.com' },
  { vendor: 'google-hosted-libraries', host: 'ajax.googleapis.com' },
  { vendor: 'cdnjs', host: 'cdnjs.cloudflare.com' },
  { vendor: 'jsdelivr', host: 'cdn.jsdelivr.net' },
  { vendor: 'unpkg', host: 'unpkg.com' },
  { vendor: 'gravatar', host: 'gravatar.com' },
  { vendor: 'recaptcha', host: 'google.com', path: '/recaptcha' },
  { vendor: 'recaptcha', host: 'recaptcha.net' },
  { vendor: 'recaptcha', host: 'gstatic.com', path: '/recaptcha' },
  { vendor: 'hcaptcha', host: 'hcaptcha.com' },
  { vendor: 'stripe', host: 'stripe.com' },
  { vendor: 'stripe', host: 'stripe.network' },
  { vendor: 'paypal', host: 'paypal.com' },
  { vendor: 'paypal', host: 'paypalobjects.com' },
  { vendor: 'square-payments', host: 'squarecdn.com' },
  { vendor: 'squarespace', host: 'squarespace.com' },
  { vendor: 'squarespace', host: 'squarespace-cdn.com' },
  { vendor: 'wix', host: 'parastorage.com' },
  { vendor: 'wix', host: 'wixstatic.com' },
  { vendor: 'wix', host: 'wix.com' },
  { vendor: 'instagram', host: 'instagram.com' },
  { vendor: 'instagram', host: 'cdninstagram.com' },
];

function hostMatches(host: string, rule: string): boolean {
  return host === rule || host.endsWith('.' + rule);
}

/** Which vendor a request URL belongs to, or null when the table does not know it. */
export function vendorForUrl(url: string): Vendor | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  for (const rule of HOST_RULES) {
    if (!hostMatches(host, rule.host)) continue;
    if (rule.path && !u.pathname.startsWith(rule.path)) continue;
    return VENDORS[rule.vendor];
  }
  return null;
}

/** Hosts that belong to no vendor in particular (generic Google and Facebook hosts without a matching path). */
export function isBareBigTechHost(host: string): boolean {
  return ['google.com', 'gstatic.com', 'facebook.com', 'googleapis.com'].some((h) => hostMatches(host, h));
}

/** All vendors, sorted for display. */
export function vendorList(): Vendor[] {
  return Object.values(VENDORS).sort((a, b) => KINDS[a.kind].label.localeCompare(KINDS[b.kind].label) || a.name.localeCompare(b.name));
}

export const BAA_LABEL: Record<BaaStatus, string> = {
  offers: 'Signs a BAA',
  'some-plans': 'BAA on some plans only',
  no: 'No BAA',
  ask: 'Ask the vendor',
};

/** Every host rule, exposed for tests that check the table is consistent. */
export function hostRules(): ReadonlyArray<Readonly<HostRule>> {
  return HOST_RULES;
}
