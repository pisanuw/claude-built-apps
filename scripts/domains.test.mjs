import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_DOMAIN, OLD_DOMAIN, HOST_RENAMES, appDomainFor, oldDomainFor, hostLabelOf, isSubdomainOf } from './domains.mjs';

test('the two base domains', () => {
  assert.equal(APP_DOMAIN, 'hintwise.org');
  assert.equal(OLD_DOMAIN, 'pisan.me');
});

test('appDomainFor moves pisan.me names to hintwise.org', () => {
  assert.equal(appDomainFor('bombe-bench.pisan.me'), 'bombe-bench.hintwise.org');
  assert.equal(appDomainFor(' Pull-The-Pin.Pisan.Me. '), 'pull-the-pin.hintwise.org');
});

test('appDomainFor leaves other domains alone', () => {
  assert.equal(appDomainFor('pisan.me'), 'pisan.me');
  assert.equal(appDomainFor('bombe-bench.hintwise.org'), 'bombe-bench.hintwise.org');
  assert.equal(appDomainFor('digital-student-assistant.com'), 'digital-student-assistant.com');
  assert.equal(appDomainFor('notpisan.me'), 'notpisan.me');
  assert.equal(appDomainFor('x.pisan.me.evil.com'), 'x.pisan.me.evil.com');
  assert.equal(appDomainFor(''), '');
  assert.equal(appDomainFor(undefined), '');
});

test('oldDomainFor is the inverse for hintwise.org names', () => {
  assert.equal(oldDomainFor('bombe-bench.hintwise.org'), 'bombe-bench.pisan.me');
  assert.equal(oldDomainFor('hintwise.org'), 'hintwise.org');
  assert.equal(oldDomainFor('example.com'), 'example.com');
  assert.equal(oldDomainFor(null), '');
  assert.equal(oldDomainFor(appDomainFor('a.pisan.me')), 'a.pisan.me');
});

test('hostLabelOf and isSubdomainOf', () => {
  assert.equal(hostLabelOf('mult-streak.pisan.me'), 'mult-streak');
  assert.equal(hostLabelOf('mult-streak.hintwise.org'), 'mult-streak');
  assert.equal(hostLabelOf('foo.example.com'), 'foo');
  assert.equal(isSubdomainOf('a.pisan.me', 'pisan.me'), true);
  assert.equal(isSubdomainOf('pisan.me', 'pisan.me'), false);
  assert.equal(isSubdomainOf('xpisan.me', 'pisan.me'), false);
});

test('HOST_RENAMES exceptions map both ways', () => {
  assert.equal(HOST_RENAMES['daily-project-ideas'], 'studio');
  assert.equal(appDomainFor('daily-project-ideas.pisan.me'), 'studio.hintwise.org');
  assert.equal(oldDomainFor('studio.hintwise.org'), 'daily-project-ideas.pisan.me');
  assert.equal(appDomainFor('ypai.pisan.me'), 'ypai.hintwise.org');
  assert.equal(appDomainFor('constructor.pisan.me'), 'constructor.hintwise.org');
});
