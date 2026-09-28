// Sends the resources (forging goods) waiting in the packages to the Horreum.
//
// The Horreum page has the game's own "Store resources" form: where to take
// resources from (bags and/or packages), what to do with what does not fit
// (sell or delete) and a button. Instead of guessing the request behind that
// button, GBot loads the Horreum page in a hidden frame, fills in the form
// (packages only, sell the excess, never delete) and presses the button, so
// the game's own code does the transfer.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { SEL, PAGES, buildUrl } = GBot.selectors;
  const { waitFor, sleep, parseNumber, isVisible, ActionError } = GBot.util;

  const LOAD_TIMEOUT_MS = 20000;
  const STORE_TIMEOUT_MS = 30000;

  // Resources on the packages page currently shown: { packages, amount }.
  function countPackageResources(doc) {
    const items = Array.from(doc.querySelectorAll(SEL.packages.resource));
    const amount = items.reduce((sum, el) => sum + (parseNumber(el.getAttribute('data-amount')) || 1), 0);
    return { packages: items.length, amount };
  }

  function loadFrame(url) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      // Laid out (the game's scripts may measure things) but invisible.
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:800px;border:0;visibility:hidden;';
      const timer = setTimeout(() => {
        frame.remove();
        reject(new ActionError('The Horreum page did not load'));
      }, LOAD_TIMEOUT_MS);
      frame.addEventListener(
        'load',
        () => {
          clearTimeout(timer);
          resolve(frame);
        },
        { once: true }
      );
      frame.src = url;
      document.body.appendChild(frame);
    });
  }

  // Makes a checkbox or radio have the wanted state by clicking it, so the
  // game's own change handlers run (they enable the Store button).
  function setChecked(input, wanted) {
    if (input.checked !== wanted) input.click();
    return input.checked === wanted;
  }

  // The "sell" radio of the overflow choice: by its value when that says so,
  // otherwise the first one (the game lists sell before delete).
  function sellOption(radios) {
    const sell = radios.find((r) => /sell/i.test(r.value));
    if (sell) return sell;
    const keep = radios.filter((r) => !/delete|remove|destroy/i.test(r.value));
    return keep.length < radios.length ? keep[0] : radios[0];
  }

  // Runs the transfer. onStep(text) reports progress. Resolves when the game
  // has handled the request; throws ActionError with a readable message.
  async function storeFromPackages({ sh, onStep = () => {} }) {
    if (!sh) throw new ActionError('No session found; reload the page and try again');
    onStep('Opening the Horreum…');
    const frame = await loadFrame(buildUrl(location.href, sh, PAGES.horreum()));
    try {
      const doc = frame.contentDocument;
      if (!doc) throw new ActionError('Could not open the Horreum page');
      const $ = (sel) => doc.querySelector(sel);
      const fromPackages = $(SEL.horreum.fromPackages);
      const fromInventory = $(SEL.horreum.fromInventory);
      const store = $(SEL.horreum.store);
      const excess = Array.from(doc.querySelectorAll(SEL.horreum.excess));
      if (!fromPackages || !store) {
        throw new ActionError('The Horreum page looks different than expected (no "from packages" option or Store button)');
      }

      // Packages only: resources in the bags stay where they are.
      if (fromInventory && !setChecked(fromInventory, false)) throw new ActionError('Could not untick "from inventory"');
      if (!setChecked(fromPackages, true)) throw new ActionError('Could not tick "from packages"');
      // Whatever does not fit is sold, never deleted.
      if (excess.length) {
        const sell = sellOption(excess);
        if (!sell || !setChecked(sell, true)) throw new ActionError('Could not choose "sell" for resources that do not fit');
      }

      const enabled = await waitFor(() => !store.disabled && !store.hasAttribute('disabled'), 3000, 100);
      if (!enabled) throw new ActionError('The Horreum\'s Store button stayed disabled');

      // Done when the frame loads a new page or the stock table changes.
      let reloaded = false;
      frame.addEventListener('load', () => (reloaded = true), { once: true });
      const stockBefore = ($(SEL.horreum.stock) || {}).textContent;

      onStep('Sending the resources…');
      store.click();

      const outcome = await waitFor(() => {
        if (reloaded) return 'done';
        const current = frame.contentDocument;
        if (!current) return null;
        const dialog = Array.from(current.querySelectorAll(SEL.horreum.dialog)).find((d) => isVisible(d));
        if (dialog) return 'dialog';
        const stock = current.querySelector(SEL.horreum.stock);
        if (stock && stock.textContent !== stockBefore) return 'done';
        return null;
      }, STORE_TIMEOUT_MS, 200);

      if (outcome === 'dialog') {
        throw new ActionError('The Horreum asked for a confirmation GBot does not know; store the resources on the Horreum page yourself');
      }
      if (!outcome) throw new ActionError('The Horreum did not confirm the transfer; check the Horreum page');
      // Let a reload or follow-up request finish before the frame goes away.
      await sleep(800);
      return true;
    } finally {
      frame.remove();
    }
  }

  GBot.horreum = { countPackageResources, storeFromPackages, _internal: { sellOption } };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.horreum;
})(typeof globalThis !== 'undefined' ? globalThis : this);
