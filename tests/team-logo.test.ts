import assert from 'node:assert/strict';
import test from 'node:test';
import { espnUploadId, isEspnUploadId, teamLogoSrc } from '../src/lib/league/teamLogo.js';

const upload = 'https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/4a255de0-cf67-11f1-91e2-3915bbb7cba0';

test('a logo uploaded to ESPN loads through our server', () => {
  assert.equal(teamLogoSrc(upload), '/api/espn/team-logo/4a255de0-cf67-11f1-91e2-3915bbb7cba0');
  assert.equal(espnUploadId(upload), '4a255de0-cf67-11f1-91e2-3915bbb7cba0');
});

test('a Wikipedia thumbnail asks for a width Wikipedia serves', () => {
  assert.equal(
    teamLogoSrc('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/LeBron_James_Lakers.jpg/146px-LeBron_James_Lakers.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/LeBron_James_Lakers.jpg/120px-LeBron_James_Lakers.jpg',
  );
});

test('every other logo loads as ESPN gives it, and no logo stays empty', () => {
  for (const url of ['https://i.ibb.co/BgqXM2k/IMG-20221226-174734-2.jpg', 'https://g.espncdn.com/lm-static/logo-packs/fba/8-bitHeros-JoeyEllis/8bit_basketball-01.svg']) {
    assert.equal(teamLogoSrc(url), url);
  }
  assert.equal(teamLogoSrc(null), null);
  assert.equal(teamLogoSrc(''), null);
});

test('the logo route only fetches an ESPN upload id', () => {
  assert.equal(isEspnUploadId('4a255de0-cf67-11f1-91e2-3915bbb7cba0'), true);
  for (const id of ['../secrets', 'https://example.com/x.png', '4a255de0-cf67-11f1-91e2', '']) assert.equal(isEspnUploadId(id), false);
  assert.equal(espnUploadId('https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/../x'), null);
});
