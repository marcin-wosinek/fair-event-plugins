/**
 * @jest-environment jsdom
 *
 * Regression test for #993: All Events must show the same wall-clock time
 * as Manage Event / the DB for a given `start_datetime`, regardless of the
 * site timezone.
 */
// Pin the "browser" timezone so the assertion doesn't depend on the
// machine running the test — the bug only reproduces when this differs
// from the site timezone set below.
process.env.TZ = 'UTC';

import { getSettings, setSettings } from '@wordpress/date';
import { formatSiteLocalDatetime } from '../AllEvents.js';

it('formats a naive datetime without applying the site timezone offset', () => {
	const settings = getSettings();

	setSettings({
		...settings,
		timezone: {
			...settings.timezone,
			offset: 2,
			offsetFormatted: '+2',
			string: 'Europe/Madrid',
		},
	});

	try {
		expect(formatSiteLocalDatetime('2026-09-01 10:00:00')).toBe(
			'September 1, 2026 10:00 am'
		);
	} finally {
		setSettings(settings);
	}
});
