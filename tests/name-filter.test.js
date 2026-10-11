const assert = require('node:assert/strict');
const { isBlockedName } = require('../src/name-filter.js');

const blocked = ['fuck', 'F.U.C.K', 'f u c k', 'Fvck', 'sh1t', 'shiiiit', '$hit', 'Big Ass', 'BigAss', 'a s s', 'b!tch',
  'Assh0le', 'dumbass', '5ex', 'w h o r e', 'Group 69', '420 squad', 'Spics'];
const allowed = ['Class Act', 'Bill & Ana', 'Grapes', 'Scunthorpe', 'Pair 01', 'Team 5', 'Group 9', 'Bass Masters', 'Cassie and Jo',
  'Assignment Crew', 'Mississippi', 'Peacock', 'Hancock', 'Cockpit', 'Titans', 'Analysis', 'Canal', 'Cucumber', 'Document',
  'Thorny Roses', 'Essex', 'Hello', 'Shell', 'Happiness', 'Therapist', 'Torpedo', 'Japan', 'Raccoons', 'Grasshopper',
  'Passive', 'Spicy', 'Hornets', 'Cumulus', 'Sextant', 'Dickens', 'Tower Power'];

for (const name of blocked) assert.equal(isBlockedName(name), true, `${name} is blocked`);
for (const name of allowed) assert.equal(isBlockedName(name), false, `${name} is allowed`);
console.log('name filter tests passed');
