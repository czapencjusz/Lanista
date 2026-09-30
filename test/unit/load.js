// Loads the content-script modules into Node in manifest order and returns
// the GBot namespace.
'use strict';
require('../../src/shared/settings.js');
require('../../src/content/util.js');
require('../../src/content/selectors.js');
require('../../src/content/state.js');
require('../../src/content/brain.js');

module.exports = globalThis.GBot;
