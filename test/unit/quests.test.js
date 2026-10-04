'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { brain, settings: S } = require('./load');
require('../../src/content/actions.js');
const { questRewards } = GBot.actions._internal;

// A quest offer as on s303-en (2026-10-04): gold as text, grace, honour and
// experience in tooltips, an optional item reward (an image with the item's
// tooltip), and "00:17:59" on quests with a time limit.
const tip = (lines) => JSON.stringify([lines.map((l) => [l, 'white'])]).replace(/"/g, '&quot;');
const slot = ({ gold = '10.395', honour = '1.039', xp = '8', item = null, time = '' } = {}) =>
  `<div class="contentboard_slot contentboard_slot_inactive">
     <div class="quest_slot_title">Mine: Defeat 4 x Draug</div>
     <div class="quest_slot_reward_box"><span class="quest_slot_reward_text">Reward:</span>
       <div class="quest_slot_reward quest_slot_reward_gold"><span data-tooltip="${tip(['Gold'])}">${gold}</span><img></div>
       <div class="quest_slot_reward quest_slot_reward_god"><span data-tooltip="${tip(['4 grace from Apollo'])}"></span><img></div>
       <div class="quest_slot_reward quest_slot_reward_honor"><span data-tooltip="${tip([`${honour} Honor`])}"></span><img></div>
       <div class="quest_slot_reward quest_slot_reward_xp"><span data-tooltip="${tip([`${xp} Experience`])}"></span><img></div>
       <div class="quest_slot_reward quest_slot_reward_item">${item ? `<img alt="" data-tooltip="${tip(item)}">` : ''}</div>
     </div>
     <div class="quest_slot_time">${time}</div>
   </div>`;
const read = (opts) => questRewards(new JSDOM(slot(opts)).window.document.querySelector('.contentboard_slot'));

const STEAK = ['Quintus Steak sandwich of generosity', 'Using: Heals 4635 of life', 'From intelligence: +2325 vitality point(s)'];
const MURMILLO = ['Spurius Murmillo of diligence', 'Armour 120', 'Constitution +12'];

test('quest rewards: gold, honour and experience, food rewards, time limits', () => {
  assert.deepEqual(read(), { reward: 10395, honour: 1039, xp: 8, foodReward: false, timed: false });
  assert.equal(read({ item: STEAK }).foodReward, true);
  assert.equal(read({ item: MURMILLO }).foodReward, false, 'gear is not food');
  assert.equal(read({ time: '00:17:59' }).timed, true);
  assert.equal(read({ time: 'Failed' }).timed, false);
});

test('quest rules: skip time limits and food rewards, rank by the chosen reward', () => {
  const settings = (quests) => S.sanitizeSettings({ expedition: { enabled: true }, quests: { enabled: true, matchLocation: false, ...quests } });
  const offers = [
    { type: 'expedition', title: 'A', reward: 16000, honour: 200, xp: 5, timed: true, foodReward: false },
    { type: 'expedition', title: 'B', reward: 9000, honour: 1500, xp: 9, timed: false, foodReward: true },
    { type: 'expedition', title: 'C', reward: 10000, honour: 900, xp: 30, timed: false, foodReward: false },
  ];
  const pick = (quests) => (brain.chooseQuest(offers, settings(quests), {}) || {}).title;
  assert.equal(pick({}), 'A', 'most gold by default');
  assert.equal(pick({ skipTimed: true }), 'C');
  assert.equal(pick({ rankBy: 'honour' }), 'B');
  assert.equal(pick({ rankBy: 'honour', skipFoodReward: true }), 'C');
  assert.equal(pick({ rankBy: 'xp' }), 'C');
  assert.equal(pick({ skipTimed: true, skipFoodReward: true, rankBy: 'honour' }), 'C');
  const defaults = S.sanitizeSettings({}).quests;
  assert.deepEqual([defaults.skipTimed, defaults.skipFoodReward, defaults.rankBy], [false, false, 'gold']);
});
