/**
 * Toggle one Fair Events Experimental bundle on the wp-env `tests` site.
 *
 * The tests site runs fair-events-experimental, whose bundles change some
 * core screens (e.g. `organizers`, off by default, moves the Organizer
 * settings tab to its own Organizers page). Specs set the state they need
 * for their run and restore the previous value afterwards.
 */

import { wpCli } from './wp-cli.js';

const OPTION = 'fair_events_experimental_features';

function storedFeatures() {
	const out = wpCli(`option get ${OPTION} --format=json`, {
		allowFailure: true,
	}).trim();
	const parsed = out ? JSON.parse(out) : {};
	// An empty PHP array comes back as `[]`; keys set on it would be lost.
	return parsed && !Array.isArray(parsed) && 'object' === typeof parsed
		? parsed
		: {};
}

/**
 * Set a bundle's stored state, keeping the other bundles as they are.
 *
 * @param {string}            key   Bundle key, e.g. `organizers`.
 * @param {boolean|undefined} value New state; `undefined` removes the stored
 *                                  value so the bundle's default applies.
 * @return {boolean|undefined} The previously stored value, for restoring.
 */
export function setExperimentalFeature(key, value) {
	const features = storedFeatures();
	const previous = Object.prototype.hasOwnProperty.call(features, key)
		? features[key]
		: undefined;

	if (undefined === value) {
		// The option's sanitizer keeps stored values for keys a write leaves
		// out, so clearing one means rewriting the option from scratch.
		delete features[key];
		wpCli(`option delete ${OPTION}`, { allowFailure: true });
		if (0 === Object.keys(features).length) {
			return previous;
		}
	} else {
		features[key] = value;
	}

	wpCli(
		`option update ${OPTION} '${JSON.stringify(features)}' --format=json`
	);
	return previous;
}
