/**
 * The sample delivery email: a made-up pattern shop (on the reserved
 * .example domain) whose download email reached Gmail's Promotions tab,
 * signed by its platform's shared domain rather than its own, with no DMARC
 * record. Its download link points at a small PDF served by this app, so
 * the link test runs in the browser without signing in.
 */
export const SAMPLE_FILE_PATH = 'sample/canary-pattern.pdf';

export function sampleFileUrl(origin: string, basePath = '/'): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${origin}${base}${SAMPLE_FILE_PATH}`;
}

export function sampleEmail(fileUrl: string): string {
  const html = `<html><body style="font-family:Arial,sans-serif">
<p><img src="https://cdn.juniperstitch.example/logo.png" alt="Juniper Stitch" width="160"></p>
<h1>Your pattern is ready</h1>
<p>Hi there, thank you for your order #1042!</p>
<p>Your files are ready to download:</p>
<p><a href="${fileUrl}" style="background:#2b6cb0;color:#fff;padding:12px 20px;border-radius:4px;text-decoration:none">Download Meadow Cardigan pattern (PDF)</a></p>
<p>The link works for 30 days and 5 downloads.</p>
<p>Use code SPRING20 for 20% off your next pattern! <a href="https://juniperstitch.example/collections/new">Shop new arrivals</a></p>
<p><a href="https://instagram.com/juniperstitch">Instagram</a> | <a href="https://juniperstitch.example/pages/unsubscribe">Unsubscribe</a></p>
</body></html>`;
  const text = `Your pattern is ready\n\nThank you for your order #1042!\n\nDownload Meadow Cardigan pattern (PDF): ${fileUrl}\n\nThe link works for 30 days and 5 downloads.\n`;
  return [
    'Delivered-To: canary.seed@gmail.com',
    'X-Gmail-Labels: Inbox,Category Promotions',
    'Received: by 2002:a05:7300:1234:b0:1ab:cdef:1234 with SMTP id x12csp334455dyc;',
    '        Thu, 12 Nov 2026 02:14:41 -0800 (PST)',
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@shopifyemail.com header.s=s1 header.b=AbCdEf12;',
    '       spf=pass (google.com: domain of bounces+1042@shops.shopifyemail.com designates 192.0.2.10 as permitted sender) smtp.mailfrom=bounces+1042@shops.shopifyemail.com;',
    '       dmarc=none (p=NONE sp=NONE dis=NONE) header.from=juniperstitch.example',
    'Return-Path: <bounces+1042@shops.shopifyemail.com>',
    'Received: from mail.shops.shopifyemail.com (mail.shops.shopifyemail.com. [192.0.2.10])',
    '        by mx.google.com with ESMTPS id a1si2233445qkb.101.2026.11.12.02.14.02',
    '        for <canary.seed@gmail.com>;',
    '        Thu, 12 Nov 2026 02:14:02 -0800 (PST)',
    'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=shopifyemail.com; s=s1; h=from:to:subject; bh=abc=; b=def=',
    'Date: Thu, 12 Nov 2026 10:13:58 +0000',
    'From: Juniper Stitch <hello@juniperstitch.example>',
    'To: canary.seed@gmail.com',
    'Subject: Your download: Meadow Cardigan pattern (order #1042)',
    'Message-ID: <sample-1042@juniperstitch.example>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '--b1--',
    '',
  ].join('\r\n');
}
