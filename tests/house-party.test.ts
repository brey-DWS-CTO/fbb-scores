import assert from 'node:assert/strict';
import test from 'node:test';
import {
  byNight,
  cancelParty,
  canManage,
  cleanFavorites,
  cleanPartyGames,
  cleanPartyNote,
  editParty,
  fansOf,
  gameDay,
  guestStakes,
  lastName,
  liveParties,
  MAX_PARTY_NOTE,
  normalizeTeam,
  openParty,
  parseScoreboard,
  partiesForGame,
  partyHeadline,
  partyId,
  partyOver,
  partyTally,
  rankGames,
  rivalryIn,
  rsvp,
  stakesIn,
  takeHosting,
  teamNickname,
  whoIsIn,
  whyLine,
  type HouseParty,
  type NbaGame,
  type RostersByOwner,
} from '../src/lib/league/houseParty.ts';

// ─── Teams and favorites ────────────────────────────────────────────────────

test('a team can be named by code, nickname, city or ESPN spelling', () => {
  assert.equal(normalizeTeam('GSW'), 'GSW');
  assert.equal(normalizeTeam('gs'), 'GSW');
  assert.equal(normalizeTeam('Warriors'), 'GSW');
  assert.equal(normalizeTeam('Golden State'), 'GSW');
  assert.equal(normalizeTeam('Sixers'), null, 'Sixers is a nickname ESPN does not use');
  assert.equal(normalizeTeam('76ers'), 'PHI');
  assert.equal(normalizeTeam('Kings'), 'SAC');
  assert.equal(normalizeTeam(''), null);
  assert.equal(normalizeTeam(7), null);
  assert.equal(teamNickname('MEM'), 'Grizzlies');
});

test('favorites need a first team and a different second one', () => {
  assert.deepEqual(cleanFavorites({ first: 'Lakers', second: '' }), { ok: true, favorites: { first: 'LAL', second: null } });
  assert.deepEqual(cleanFavorites({ first: 'PHI', second: 'LAL' }), { ok: true, favorites: { first: 'PHI', second: 'LAL' } });
  assert.deepEqual(cleanFavorites({ first: '' }), { ok: false, problem: 'no-first' });
  assert.deepEqual(cleanFavorites({ first: 'Raiders' }), { ok: false, problem: 'bad-team' });
  assert.deepEqual(cleanFavorites({ first: 'SAC', second: 'Kings' }), { ok: false, problem: 'same-team' });
});

test('fans of a team list first-team fans before second-team fans', () => {
  const favorites = { Patrick: { first: 'PHI', second: 'LAL' }, Dustin: { first: 'LAL', second: null }, Aaron: { first: 'LAL', second: null } };
  assert.deepEqual(fansOf(favorites, 'LAL'), ['Aaron', 'Dustin', 'Patrick']);
  assert.deepEqual(fansOf(favorites, 'BOS'), []);
});

// ─── The scoreboard ─────────────────────────────────────────────────────────

const competitor = (abbreviation: string, homeAway: 'home' | 'away', score?: string) => ({
  homeAway,
  score,
  team: { abbreviation },
});

const scoreboard = {
  events: [
    {
      id: '401',
      date: '2026-10-21T02:30Z',
      competitions: [{
        id: '401',
        date: '2026-10-21T02:30Z',
        broadcasts: [{ names: ['Spectrum SportsNet'] }, { names: ['TNT'] }],
        competitors: [competitor('GSW', 'home'), competitor('LAL', 'away')],
        status: { type: { state: 'pre', shortDetail: '10/20 - 7:30 PM PDT' } },
      }],
    },
    {
      id: '402',
      date: '2026-10-21T00:00Z',
      competitions: [{
        competitors: [competitor('SAC', 'home', '101'), competitor('PHX', 'away', '99')],
        status: { type: { state: 'post', shortDetail: 'Final' } },
      }],
    },
    { id: 'no-teams', date: '2026-10-21T00:00Z', competitions: [{ competitors: [competitor('GSW', 'home')] }] },
    { id: 'no-date', competitions: [{ competitors: [competitor('GSW', 'home'), competitor('LAL', 'away')] }] },
    'junk',
  ],
};

test('the scoreboard keeps only whole games, in time order, with national TV', () => {
  const games = parseScoreboard(scoreboard);
  assert.deepEqual(games.map((game) => game.id), ['402', '401']);
  const warriors = games[1];
  assert.equal(warriors.home, 'GSW');
  assert.equal(warriors.away, 'LAL');
  assert.equal(warriors.tv, 'TNT', 'the regional network is not TV worth driving for');
  assert.equal(warriors.state, 'pre');
  assert.equal(warriors.homeScore, null);
  const kings = games[0];
  assert.equal(kings.state, 'post');
  assert.equal(kings.homeScore, 101);
  assert.equal(kings.awayScore, 99);
  assert.equal(kings.tv, null);
  assert.equal(kings.detail, 'Final');
  assert.deepEqual(parseScoreboard(null), []);
  assert.deepEqual(parseScoreboard({ events: 'nope' }), []);
});

test('a game is dated by the Pacific night it is played', () => {
  assert.equal(gameDay('2026-10-21T02:30:00.000Z'), '2026-10-20', 'a 7:30 PM Pacific tip is still the 20th');
  assert.equal(gameDay('2026-10-21T17:00:00.000Z'), '2026-10-21');
});

// ─── Rosters and ranking ────────────────────────────────────────────────────

const game = (id: string, home: string, away: string, tipoff: string, tv: string | null = null, state: NbaGame['state'] = 'pre'): NbaGame => ({
  id, home, away, tipoff, tv, state, detail: '', homeScore: null, awayScore: null,
});

const GAMES: NbaGame[] = [
  game('lal-gsw', 'GSW', 'LAL', '2026-10-21T02:30:00.000Z', 'TNT'),
  game('den-min', 'MIN', 'DEN', '2026-10-21T00:00:00.000Z'),
  game('sac-phx', 'PHX', 'SAC', '2026-10-22T02:00:00.000Z'),
  game('bos-mia', 'MIA', 'BOS', '2026-10-20T23:30:00.000Z', 'ESPN'),
];

const ROSTERS: RostersByOwner = {
  Kyle: [{ key: 'curry', name: 'Stephen Curry', proTeam: 'GS' }, { key: 'jokic', name: 'Nikola Jokic', proTeam: 'DEN' }],
  Dustin: [{ key: 'lebron', name: 'LeBron James', proTeam: 'LAL' }, { key: 'reaves', name: 'Austin Reaves', proTeam: 'LAL' }],
  Derek: [{ key: 'sabonis', name: 'Domantas Sabonis', proTeam: 'SAC' }],
  Ryan: [{ key: 'edwards', name: 'Anthony Edwards', proTeam: 'MIN' }],
  Amy: [],
};

const FAVORITES = { Kyle: { first: 'GSW', second: null }, Dustin: { first: 'LAL', second: null }, Derek: { first: 'SAC', second: null }, Patrick: { first: 'PHI', second: 'LAL' } };

test('stakes match ESPN team spellings and put the biggest stake first', () => {
  const stakes = stakesIn(GAMES[0], ROSTERS);
  assert.deepEqual(stakes.map((stake) => [stake.owner, stake.players.length]), [['Dustin', 2], ['Kyle', 1]]);
});

test('a rivalry is two owners on opposite sides, and none when everyone is on one side', () => {
  const rivalry = rivalryIn(GAMES[0], stakesIn(GAMES[0], ROSTERS));
  assert.deepEqual(rivalry, {
    a: { owner: 'Dustin', player: 'James', team: 'LAL' },
    b: { owner: 'Kyle', player: 'Curry', team: 'GSW' },
  });
  assert.equal(rivalryIn(GAMES[2], stakesIn(GAMES[2], ROSTERS)), null);
});

test('last names drop first names, initials and suffixes', () => {
  assert.equal(lastName('LeBron James'), 'James');
  assert.equal(lastName('N. Jokic'), 'Jokic');
  assert.equal(lastName('Jaren Jackson Jr.'), 'Jackson');
  assert.equal(lastName('Nene'), 'Nene');
});

test('the WATCH list puts a favorite first, then your own players, then the rest, and finals last', () => {
  const ranked = rankGames({ viewer: 'Kyle', games: GAMES, favorites: FAVORITES, rosters: ROSTERS });
  assert.deepEqual(ranked.map((row) => row.id), ['lal-gsw', 'den-min', 'bos-mia', 'sac-phx']);
  const top = ranked[0];
  assert.deepEqual(top.favorites, ['GSW']);
  assert.equal(top.mine.length, 1);
  assert.equal(top.why, "Your Warriors. You have Curry, Dustin has James and Reaves. Dustin's James vs Kyle's Curry. On TNT.");
  assert.equal(ranked[1].why, 'You have Jokic, Ryan has Edwards. Kyle\'s Jokic vs Ryan\'s Edwards.');
  assert.equal(ranked[2].why, 'On ESPN.');
  assert.ok(ranked[0].score > ranked[1].score && ranked[1].score > ranked[2].score);
});

test('a game that is over sinks below every game still to come', () => {
  const games = [{ ...GAMES[0], state: 'post' as const }, GAMES[3]];
  const ranked = rankGames({ viewer: 'Kyle', games, favorites: FAVORITES, rosters: ROSTERS });
  assert.deepEqual(ranked.map((row) => row.id), ['bos-mia', 'lal-gsw']);
});

test('a viewer with no favorites and no players still gets a list, TV first', () => {
  const ranked = rankGames({ viewer: 'Amy', games: GAMES, favorites: FAVORITES, rosters: ROSTERS });
  assert.equal(ranked[0].id, 'lal-gsw', 'TNT plus the most league players');
  assert.equal(ranked[0].why, "Dustin has James and Reaves, Kyle has Curry. Dustin's James vs Kyle's Curry. On TNT.");
});

test('the why line names at most two owners and counts the rest', () => {
  const rosters: RostersByOwner = {
    ...ROSTERS,
    Aaron: [{ key: 'a', name: 'Jonathan Kuminga', proTeam: 'GSW' }],
    Joel: [{ key: 'j', name: 'Rui Hachimura', proTeam: 'LAL' }],
  };
  const ranked = rankGames({ viewer: 'Amy', games: [GAMES[0]], favorites: {}, rosters });
  assert.match(ranked[0].why, /2 more teams have players in it/);
  const line = whyLine('Amy', { favorites: [], mine: [], stakes: [], tv: null, rivalry: null });
  assert.equal(line, '');
});

test('nights group games by Pacific day in time order', () => {
  const ranked = rankGames({ viewer: 'Kyle', games: GAMES, favorites: FAVORITES, rosters: ROSTERS });
  const nights = byNight(ranked);
  assert.deepEqual(nights.map((night) => night.day), ['2026-10-20', '2026-10-21']);
  assert.deepEqual(nights[0].games.map((row) => row.id), ['bos-mia', 'den-min', 'lal-gsw']);
});

// ─── Parties ────────────────────────────────────────────────────────────────

const AT = '2026-10-19T18:00:00.000Z';

function party(overrides: Partial<HouseParty> = {}): HouseParty {
  const games = cleanPartyGames(['lal-gsw', 'den-min'], GAMES);
  assert.ok(games.ok);
  return {
    ...openParty({ id: 'abc', season: 2027, by: 'Kyle', hosting: true, games: games.value, note: '12 Elm St. Bring beer.', at: AT }),
    ...overrides,
  };
}

test('party games must be on the schedule, on one night, one to three, no repeats, in the order given', () => {
  const ok = cleanPartyGames(['den-min', 'lal-gsw'], GAMES);
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.map((row) => row.id), ['den-min', 'lal-gsw']);
  assert.deepEqual(ok.value[1], { id: 'lal-gsw', tipoff: GAMES[0].tipoff, home: 'GSW', away: 'LAL', tv: 'TNT' });
  assert.deepEqual(cleanPartyGames([], GAMES), { ok: false, problem: 'no-games' });
  assert.deepEqual(cleanPartyGames('lal-gsw', GAMES), { ok: false, problem: 'no-games' });
  assert.deepEqual(cleanPartyGames(['lal-gsw', 'den-min', 'bos-mia', 'sac-phx'], GAMES), { ok: false, problem: 'too-many-games' });
  assert.deepEqual(cleanPartyGames(['lal-gsw', 'lal-gsw'], GAMES), { ok: false, problem: 'same-game-twice' });
  assert.deepEqual(cleanPartyGames(['lal-gsw', 'nope'], GAMES), { ok: false, problem: 'unknown-game' });
  assert.deepEqual(cleanPartyGames(['lal-gsw', 'sac-phx'], GAMES), { ok: false, problem: 'different-nights' });
});

test('a note is trimmed and capped', () => {
  assert.deepEqual(cleanPartyNote('  12 Elm   St. '), { ok: true, value: '12 Elm St.' });
  assert.deepEqual(cleanPartyNote(undefined), { ok: true, value: '' });
  assert.deepEqual(cleanPartyNote('x'.repeat(MAX_PARTY_NOTE + 1)), { ok: false, problem: 'note-too-long' });
});

test('opening a party puts the opener in; an "up for it" has no host', () => {
  const hosted = party();
  assert.equal(hosted.host, 'Kyle');
  assert.deepEqual(whoIsIn(hosted), ['Kyle']);
  const open = party({ host: null });
  assert.equal(open.host, null);
  assert.equal(open.createdBy, 'Kyle');
});

test('a share id is eight safe characters and differs by moment', () => {
  const a = partyId(AT, 0.25);
  const b = partyId('2026-10-19T18:00:01.000Z', 0.25);
  assert.match(a, /^[a-z2-9]{8}$/);
  assert.notEqual(a, b);
});

test('people go in and out; the host cannot go out', () => {
  let p = party();
  const joined = rsvp(p, 'Dustin', 'in', AT);
  assert.ok(joined.ok);
  p = joined.value;
  assert.deepEqual(whoIsIn(p), ['Kyle', 'Dustin']);
  const left = rsvp(p, 'Dustin', 'out', AT);
  assert.ok(left.ok);
  assert.deepEqual(whoIsIn(left.value), ['Kyle']);
  assert.deepEqual(rsvp(p, 'Kyle', 'out', AT), { ok: false, problem: 'not-host' });
  assert.deepEqual(rsvp(p, 'Dustin', 'maybe', AT), { ok: false, problem: 'bad-answer' });
  assert.deepEqual(rsvp({ ...p, cancelledAt: AT }, 'Dustin', 'in', AT), { ok: false, problem: 'cancelled' });
});

test('anyone can take an "up for it" and host it; a hosted party is taken', () => {
  const open = party({ host: null, note: '' });
  const taken = takeHosting(open, 'Dustin', 'My place.', AT);
  assert.ok(taken.ok);
  assert.equal(taken.value.host, 'Dustin');
  assert.equal(taken.value.note, 'My place.');
  assert.deepEqual(whoIsIn(taken.value), ['Kyle', 'Dustin']);
  assert.deepEqual(takeHosting(taken.value, 'Ryan', '', AT), { ok: false, problem: 'already-hosted' });
  const again = takeHosting(taken.value, 'Dustin', '', AT);
  assert.ok(again.ok);
  assert.equal(again.value.note, 'My place.', 'an empty note keeps the old one');
});

test('only the host edits or calls off a hosted party; the opener or the commish can call off an open one', () => {
  const hosted = party();
  assert.ok(editParty(hosted, 'Kyle', { note: 'New address.' }).ok);
  assert.deepEqual(editParty(hosted, 'Dustin', { note: 'Mine now.' }), { ok: false, problem: 'not-host' });
  assert.equal(canManage(hosted, 'Dustin', false), false);
  assert.equal(canManage(hosted, 'Brey', true), true);
  const open = party({ host: null });
  assert.equal(canManage(open, 'Kyle', false), true, 'the opener');
  assert.equal(canManage(open, 'Ryan', false), false);
  const off = cancelParty(hosted, 'Kyle', false, AT);
  assert.ok(off.ok);
  assert.equal(off.value.cancelledAt, AT);
  assert.deepEqual(cancelParty(off.value, 'Kyle', false, AT), { ok: false, problem: 'cancelled' });
});

test('a party is over four hours after its last game tips', () => {
  const p = party();
  assert.equal(partyOver(p, new Date('2026-10-21T06:00:00.000Z')), false);
  assert.equal(partyOver(p, new Date('2026-10-21T06:31:00.000Z')), true);
  assert.equal(partyOver({ games: [] }, new Date()), false);
});

test('live parties leave out called-off and finished ones and sort soonest first', () => {
  const later = party({ id: 'later', games: [{ id: 'sac-phx', tipoff: GAMES[2].tipoff, home: 'PHX', away: 'SAC', tv: null }] });
  const off = party({ id: 'off', cancelledAt: AT });
  const now = new Date('2026-10-19T20:00:00.000Z');
  assert.deepEqual(liveParties([later, off, party()], now).map((row) => row.id), ['abc', 'later']);
  assert.deepEqual(liveParties([later, party()], new Date('2026-10-21T07:00:00.000Z')).map((row) => row.id), ['later']);
  assert.deepEqual(partiesForGame([later, party()], 'den-min', now).map((row) => row.id), ['abc']);
});

test('guest stakes list each guest\'s players per game, biggest stake first', () => {
  let p = party();
  for (const owner of ['Dustin', 'Ryan', 'Amy']) {
    const next = rsvp(p, owner, 'in', AT);
    assert.ok(next.ok);
    p = next.value;
  }
  const stakes = guestStakes(p, ROSTERS);
  assert.deepEqual(stakes.map((row) => [row.owner, row.total]), [['Dustin', 2], ['Kyle', 2], ['Ryan', 1], ['Amy', 0]]);
  assert.deepEqual(stakes[1].byGame.map((list) => list.map((player) => player.name)), [['Stephen Curry'], ['Nikola Jokic']]);
  assert.deepEqual(stakes[3].byGame, [[], []]);
});

test('the headline reads like a text', () => {
  assert.equal(partyHeadline(party()), 'Lakers at Warriors, Tue Oct 20, 7:30 PM. Kyle is hosting. Plus 1 more game.');
  assert.equal(partyHeadline(party({ host: null, games: party().games.slice(0, 1) })), 'Lakers at Warriors, Tue Oct 20, 7:30 PM. Nobody has the house yet.');
  assert.equal(partyHeadline({ games: [], host: null }), 'House party');
});

test('the tally counts parties that happened, most attended first', () => {
  let p = party();
  const joined = rsvp(p, 'Dustin', 'in', AT);
  assert.ok(joined.ok);
  p = joined.value;
  const after = new Date('2026-10-22T12:00:00.000Z');
  const tally = partyTally(['Kyle', 'Dustin', 'Amy'], [p, party({ id: 'off', cancelledAt: AT })], after);
  assert.deepEqual(tally, [
    { owner: 'Kyle', hosted: 1, attended: 1 },
    { owner: 'Dustin', hosted: 0, attended: 1 },
    { owner: 'Amy', hosted: 0, attended: 0 },
  ]);
  assert.deepEqual(partyTally(['Kyle'], [p], new Date(AT)), [{ owner: 'Kyle', hosted: 0, attended: 0 }], 'not yet happened');
});
