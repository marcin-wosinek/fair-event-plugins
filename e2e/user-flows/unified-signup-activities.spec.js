/**
 * E2E: selectable activities (ticket options) in the unified Event Signup
 * form (#1243).
 *
 * IMPORTANT SCOPE NOTE: fair-events' own `event-signup` block render
 * (render.php) only runs its own markup when fair-audience is *inactive* —
 * whenever fair-audience is active, render.php delegates entirely to the
 * legacy `fair-audience/event-signup` block (see
 * `unified-signup-nested-question.spec.js`). But the activities fieldset
 * this ticket adds is itself gated on fair-audience being *active*
 * (`class_exists( \FairAudience\API\EventSignupController::class )`), since
 * selections can only be persisted through fair-audience's options table.
 * Those two preconditions are mutually exclusive under the current
 * pre-#1245-cutover architecture — the same gap affects #1242's group-pricing
 * render-context work, which also has no e2e coverage for this reason. So the
 * only thing actually reachable/testable end-to-end today is the negative
 * case below: a base-alone site (fair-audience absent) must never render a
 * dead (unsubmittable) activities fieldset, even when activity options are
 * configured. Full fieldset-render coverage (checkbox display, minimum
 * enforcement, live total, add-activities section) will become reachable
 * once #1245 removes the render delegation guard; API-level coverage for the
 * create-route validation/pricing logic lives in
 * fair-audience/src/API/__tests__/EventSignupActivities.api.spec.js (same
 * reachability caveat, matching EventSignupGroupPricing.api.spec.js's
 * existing precedent).
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli } from '../support/wp-cli.js';

test.describe('Activities fieldset base-alone guard (fair-audience inactive)', () => {
	test.beforeAll(() => {
		wpCli('plugin deactivate fair-audience fair-audience-experimental');
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-audience fair-audience-experimental');
	});

	test('activities configured on the event never render dead checkboxes when fair-audience is absent', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			options: ['dinner', 'tshirt'],
		});

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		// Selections could never be persisted without fair-audience's options
		// table, so the fieldset must be entirely absent — not just hidden.
		await expect(form.locator('.fair-events-ticket-options')).toHaveCount(
			0
		);
		await expect(
			form.locator('input[name="ticket_option_ids[]"]')
		).toHaveCount(0);

		// The rest of the form still works unaffected.
		await expect(form.locator('input[name="ticket_type_id"]')).toHaveCount(
			1
		);
	});
});
