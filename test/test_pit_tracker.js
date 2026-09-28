'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { DueProcessLogParser } = require('../parser');
const { MatchArchive, getGlobalPitStats } = require('../electron/match-archive');
const { recordCompletedMatch } = require('../electron/rescan');
const { computeMatchStats, roundRoleByRosterSide } = require('../stats');

console.log('=== Test 1: Parser Pit death detection ===');
{
  const parser = new DueProcessLogParser();
  const sampleLog = [
    'Player.log started',
    'KillLogUI :: Entry :: <color=#FF5208FF>PIT</color> ROASTED <color=#27DBFFFF><noparse>FallenPlayer</noparse></color> @ 21996',
    'KillLogUI :: Entry :: <color=#00FF00FF>UAV</color> ZAPPED <color=#FF0000FF><noparse>ZappedPlayer</noparse></color> @ 22100',
    'KillLogUI :: Entry :: <color=#27DBFFFF><noparse>Shooter</noparse></color> WASTED <color=#FF083AEB><noparse>Target</noparse></color> @ 22200',
  ].join('\n');

  parser.feedText(sampleLog);
  parser.end();
  assert(parser.current !== null, 'Match should be initialized');
  assert.strictEqual(parser.current.killFeed.length, 3, 'Killfeed should have 3 entries');

  const pitEntry = parser.current.killFeed[0];
  assert.strictEqual(pitEntry.killerName, 'PIT');
  assert.strictEqual(pitEntry.verb, 'ROASTED');
  assert.strictEqual(pitEntry.victimName, 'FallenPlayer');
  assert.strictEqual(pitEntry.isEnvironmentKill, true);
  assert.strictEqual(pitEntry.isPitDeath, true);

  const uavEntry = parser.current.killFeed[1];
  assert.strictEqual(uavEntry.isEnvironmentKill, true);
  assert.strictEqual(uavEntry.isPitDeath, false);

  const playerEntry = parser.current.killFeed[2];
  assert.strictEqual(playerEntry.isEnvironmentKill, false);
  assert.strictEqual(playerEntry.isPitDeath, false);

  console.log('✓ Parser successfully detected and classified Pit deaths and UAV kills');
}

console.log('=== Test 2: recordCompletedMatch attribution of Pit kills ===');
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-pit-test-'));
  const rankedArchive = new MatchArchive(path.join(tmpDir, 'ranked.json'));
  const otherArchive = new MatchArchive(path.join(tmpDir, 'other.json'));

  const match = {
    status: 'complete',
    endMatchId: 'pit-test-match-1',
    liveMatchId: 'pit-test-match-1',
    finalScore: { side0: 1, side1: 0 },
    team0Name: 'Attackers',
    team1Name: 'Defenders',
    is2v2: false,
    players: new Map([
      ['1001', { accountId: '1001', name: 'AttackerOne', entityId: 10, rosterSide: 0 }],
      ['1002', { accountId: '1002', name: 'AttackerTwo', entityId: 11, rosterSide: 0 }],
      ['2001', { accountId: '2001', name: 'DefenderOne', entityId: 20, rosterSide: 1 }],
    ]),
    roundsByNumber: new Map([
      [
        1,
        {
          number: 1,
          roundNumber: 1,
          actionStartTick: 20000,
          teamBlocks: {
            0: {
              roundWins: 1,
              outcomeCode: 2, // didn't defuse
              members: [
                { entityId: 10, name: 'AttackerOne', accountId: '1001' },
                { entityId: 11, name: 'AttackerTwo', accountId: '1002' },
              ],
            },
            1: {
              roundWins: 0,
              outcomeCode: null,
              members: [
                { entityId: 20, name: 'DefenderOne', accountId: '2001' },
              ],
            },
          },
          kills: [
            { tick: 21000, attackerId: 20, victimId: 10, damageSource: 1, attackerSide: 1, victimSide: 0 },
          ],
          damage: [],
        },
      ],
    ]),
    killFeed: [
      // AttackerTwo fell into pit, missed by Stats::Kill
      { killerName: 'PIT', verb: 'ROASTED', victimName: 'AttackerTwo', tick: 21500, isEnvironmentKill: true, isPitDeath: true },
    ],
  };

  const mapTracker = {
    takeForRounds: () => [{ label: '[Factory] Pit Hall', tileset: 'Factory', mapName: 'Pit Hall' }],
  };

  const mockComputeMatchStats = () => ({
    roundCount: 1,
    finalScore: { side0: 1, side1: 0, source: 'roundWins' },
    teams: {
      0: [
        { accountId: '1001', name: 'AttackerOne', kills: 0, deaths: 1, assists: 0, weaponBreakdown: [] },
        { accountId: '1002', name: 'AttackerTwo', kills: 0, deaths: 1, assists: 0, weaponBreakdown: [] },
      ],
      1: [
        { accountId: '2001', name: 'DefenderOne', kills: 1, deaths: 0, assists: 0, weaponBreakdown: [] },
      ],
    },
  });

  const mockRoundRoleByRosterSide = () => ({ 0: 0, 1: 1 }); // 0 = attack, 1 = defense

  const recorded = recordCompletedMatch(match, {
    rankedArchive,
    otherArchive,
    computeMatchStats: mockComputeMatchStats,
    roundRoleByRosterSide: mockRoundRoleByRosterSide,
    mapTracker,
    accountId: '1001',
    allowInferred: true,
    deriveFinalScoreFromRounds: () => ({ side0: 1, side1: 0, source: 'rounds' }),
  });

  assert(recorded, 'Match should be recorded');
  const stored = otherArchive.getMatch('pit-test-match-1') || rankedArchive.getMatch('pit-test-match-1');
  assert(stored, 'Archived match should exist');
  assert.strictEqual(stored.mapRounds.length, 1);

  // Both attackers are dead (AttackerOne killed by DefenderOne, AttackerTwo killed by Pit)
  // Therefore roundResult should be 'elimination', not 'save'
  assert.strictEqual(stored.mapRounds[0].roundResult, 'elimination', 'Pit death should count towards attacker elimination');

  const kills = stored.mapRounds[0].kills;
  assert.strictEqual(kills.length, 2, 'Round should have 2 kills');
  const pitKill = kills.find((k) => k.killerName === 'PIT');
  assert(pitKill, 'Pit kill should be in mapRounds.kills');
  assert.strictEqual(pitKill.victimName, 'AttackerTwo');
  assert.strictEqual(pitKill.isEnvironment, true);
  assert.strictEqual(pitKill.isPit, true);

  console.log('✓ recordCompletedMatch correctly attributes Pit kill and classifies round outcome');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('=== Test 3: MatchArchive.prototype.getPitStats & getGlobalPitStats ===');
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-pit-archive-test-'));
  const ranked = new MatchArchive(path.join(tmpDir, 'ranked.json'));
  const other = new MatchArchive(path.join(tmpDir, 'other.json'));

  ranked.setLocalAccountId('1001');

  // Match 1 in ranked: Icepop dies twice, Self (Naidru) dies once
  ranked.recordMatch({
    matchId: 'ranked-match-1',
    timestamp: 1000,
    roundCount: 2,
    localAccountId: '1001',
    mapLabel: '[Factory] Hazard Line',
    teams: [
      [{ accountId: '1001', name: 'Naidru' }],
      [{ accountId: '2001', name: 'Icepop' }],
    ],
    mapRounds: [
      {
        round: 1,
        mapLabel: '[Factory] Hazard Line',
        tileset: 'Factory',
        kills: [
          { killerName: 'PIT', victimName: 'Icepop', weapon: 'ROASTED', seconds: 45, isEnvironment: false },
        ],
      },
      {
        round: 2,
        mapLabel: '[Factory] Hazard Line',
        tileset: 'Factory',
        kills: [
          { killerName: 'PIT', victimName: 'Icepop', weapon: 'ROASTED', seconds: 70, isEnvironment: true, isPit: true },
          { killerName: 'PIT', victimName: 'Naidru', weapon: 'ROASTED', seconds: 85, isEnvironment: true, isPit: true },
        ],
      },
    ],
  });

  // Match 2 in other: Boben dies once to Pit
  other.recordMatch({
    matchId: 'other-match-1',
    timestamp: 2000,
    roundCount: 1,
    localAccountId: '1001',
    mapLabel: '[Dome] Drop Zone',
    teams: [
      [{ accountId: '1001', name: 'Naidru' }],
      [{ accountId: '3001', name: 'Boben' }],
    ],
    mapRounds: [
      {
        round: 1,
        mapLabel: '[Dome] Drop Zone',
        tileset: 'Dome',
        kills: [
          { killerName: 'PIT', victimName: 'Boben', weapon: 'Pit', seconds: 30, isEnvironment: true, isPit: true },
        ],
      },
    ],
  });

  const rankedStats = ranked.getPitStats('Naidru');
  assert.strictEqual(rankedStats.totalDeaths, 3, 'Ranked should have 3 pit deaths');
  assert.strictEqual(rankedStats.selfDeaths, 1, 'Naidru should have 1 pit death');
  assert.strictEqual(rankedStats.otherDeaths, 2, 'Other should have 2 pit deaths');
  assert.strictEqual(rankedStats.topVictim.name, 'Icepop');
  assert.strictEqual(rankedStats.topVictim.count, 2);

  const globalStats = getGlobalPitStats(ranked, other, 'Naidru');
  assert.strictEqual(globalStats.totalDeaths, 4, 'Global should have 4 pit deaths (3 ranked + 1 other)');
  assert.strictEqual(globalStats.selfDeaths, 1, 'Global self deaths should be 1');
  assert.strictEqual(globalStats.otherDeaths, 3, 'Global other deaths should be 3');
  assert.strictEqual(globalStats.rankedTotal, 3);
  assert.strictEqual(globalStats.otherTotal, 1);
  assert.strictEqual(globalStats.topVictim.name, 'Icepop');
  assert.strictEqual(globalStats.topVictim.count, 2);
  assert.strictEqual(globalStats.victims.length, 3); // Icepop (2), Boben (1), Naidru (1)
  assert.strictEqual(globalStats.claims.length, 4);

  // Chronological order: most recent match first
  assert.strictEqual(globalStats.claims[0].matchId, 'other-match-1');
  assert.strictEqual(globalStats.claims[0].victimName, 'Boben');
  assert.strictEqual(globalStats.claims[1].matchId, 'ranked-match-1');

  console.log('✓ getPitStats and getGlobalPitStats accurately aggregate Pit deaths across archives');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('=== All Pit Tracker tests passed successfully! ===');
