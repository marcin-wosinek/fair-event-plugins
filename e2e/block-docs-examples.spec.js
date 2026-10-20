/**
 * Every serialized example shipped in a plugin's block-docs/ (issue #1682)
 * must survive the editor: it is inserted into a post, loaded in the block
 * editor with every block (recursively) valid, saved, reopened still valid,
 * and rendered on the frontend with the documented selector present.
 *
 * Reads the generated `<plugin>/block-docs/index.json` files, so run a build
 * (or `node scripts/block-docs.mjs generate <plugin>`) first. Entries whose
 * status is "unregistered" are skipped. A block whose metadata is defined in
 * PHP (a render-only compatibility alias) has no editor assets, so its
 * examples are checked for frontend rendering only.
 *
 * Fair Timetable and Fair Calendar Button are mapped into the tests site but
 * not activated by .wp-env.json, so they are activated here and restored
 * afterwards.
 *
 * Run: `npm run test:e2e:local -- e2e/block-docs-examples.spec.js`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/fixtures.js';
import { ADMIN_PASSWORD, ADMIN_USER, wpCli } from './support/wp-cli.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OPTIONAL_PLUGINS = ['fair-timetable', 'fair-calendar-button'];

function loadIndexes() {
	const { workspaces } = JSON.parse(
		readFileSync(join(ROOT, 'package.json'), 'utf8')
	);
	return workspaces
		.map((plugin) => join(ROOT, plugin, 'block-docs', 'index.json'))
		.filter((path) => existsSync(path))
		.map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

function collectCases() {
	const cases = [];
	for (const index of loadIndexes()) {
		const items = [
			...index.blocks.map((block) => ({ ...block, label: block.name })),
			...index.variations.map((variation) => ({
				...variation,
				label: `${variation.block} variation ${variation.variation}`,
			})),
		];
		for (const item of items) {
			if (item.status === 'unregistered') {
				continue;
			}
			for (const example of item.examples) {
				cases.push({
					plugin: index.plugin,
					label: item.label,
					editor: !String(item.metadataSource || '').startsWith(
						'php:'
					),
					example,
					markup: readFileSync(
						join(ROOT, index.plugin, example.path),
						'utf8'
					),
				});
			}
		}
	}
	return cases;
}

/**
 * Replace documented synthetic IDs with the seeded event's records.
 *
 * @param {string} markup  Example markup.
 * @param {object} example Example descriptor from index.json.
 * @param {object} seed    Seeded records: the E2E_SEED event payload and/or
 *                         a `venueId` created for the example, or null.
 * @return {string} Markup ready to insert.
 */
function substituteIds(markup, example, seed) {
	let result = markup;
	for (const attribute of Object.keys(example.syntheticIds || {})) {
		if (attribute === 'eventDateId' && seed) {
			result = result.replace(
				/"eventDateId":\d+/g,
				`"eventDateId":${seed.eventDateId}`
			);
		}
		if (attribute === 'venueId' && seed?.venueId) {
			result = result.replace(
				/"venueId":\d+/g,
				`"venueId":${seed.venueId}`
			);
		}
	}
	return result;
}

/**
 * Log in as the admin, waiting until the login page has moved focus to the
 * username field so the credentials land in the right inputs.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
async function login(page) {
	await page.goto('/wp-login.php');
	await page.waitForLoadState('load');
	// wp-login.php focuses and selects the username field on a timer after
	// load; filling before it fires can type into the wrong field.
	await page
		.waitForFunction(
			() => document.activeElement?.id === 'user_login',
			null,
			{
				timeout: 2000,
			}
		)
		.catch(() => {});
	await page.locator('#user_login').fill(ADMIN_USER);
	await page.locator('#user_pass').fill(ADMIN_PASSWORD);
	await expect(page.locator('#user_login')).toHaveValue(ADMIN_USER);
	await page.locator('#wp-submit').click();
	await page.waitForSelector('#wpadminbar');
}

async function apiFetch(page, options) {
	const result = await page.evaluate(async (opts) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch(opts) };
		} catch (error) {
			return { ok: false, message: error?.message, code: error?.code };
		}
	}, options);
	if (!result.ok) {
		throw new Error(
			`apiFetch ${options.method || 'GET'} ${options.path} failed: ${
				result.code
			} ${result.message}`
		);
	}
	return result.data;
}

/**
 * Wait for the editor to load the post with every block type it uses
 * registered, then report each block's validity recursively.
 *
 * @param {import('@playwright/test').Page} page   Playwright page.
 * @param {number}                          postId Post to open.
 * @return {Promise<object>} Editor state summary.
 */
async function openAndInspect(page, postId) {
	await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
	await page.waitForFunction(
		(id) =>
			window.wp?.data?.select('core/editor')?.getCurrentPostId() === id &&
			window.wp.data.select('core/block-editor').getBlocks().length > 0,
		postId
	);
	await page.evaluate(() => {
		// eslint-disable-next-line no-undef
		wp.data
			.dispatch('core/preferences')
			.set('core/edit-post', 'welcomeGuide', false);
	});

	return page.evaluate(() => {
		// eslint-disable-next-line no-undef
		const { select } = wp.data;
		const problems = [];
		const names = [];
		const walk = (blocks, path) => {
			for (const block of blocks) {
				const where = [...path, block.name].join(' > ');
				names.push(block.name);
				if (block.name === 'core/missing') {
					problems.push(
						`${where}: unregistered block ${block.attributes.originalName}`
					);
				} else if (!block.isValid) {
					problems.push(
						`${where}: invalid (${(block.validationIssues || [])
							.map((issue) =>
								(issue.args || [])
									.slice(1)
									.filter((arg) => typeof arg === 'string')
									.join(' / ')
							)
							.join('; ')})`
					);
				}
				walk(block.innerBlocks, [...path, block.name]);
			}
		};
		walk(select('core/block-editor').getBlocks(), []);
		return { problems, names };
	});
}

async function savePost(page) {
	await page.evaluate(async () => {
		// eslint-disable-next-line no-undef
		const { dispatch, select } = wp.data;
		const title = select('core/editor').getEditedPostAttribute('title');
		// A title edit makes the post dirty, so the save re-serializes the
		// blocks the editor parsed instead of being skipped as a no-op.
		dispatch('core/editor').editPost({ title: `${title} (saved)` });
		await dispatch('core/editor').savePost();
	});
	const saved = await page.evaluate(() =>
		// eslint-disable-next-line no-undef
		wp.data.select('core/editor').didPostSaveRequestSucceed()
	);
	expect(saved, 'the editor saved the post').toBe(true);
}

const cases = collectCases();

test.describe('Block documentation examples', () => {
	let activated = [];

	test.beforeAll(() => {
		const active = wpCli('plugin list --status=active --field=name')
			.split('\n')
			.map((name) => name.trim());
		activated = OPTIONAL_PLUGINS.filter(
			(plugin) => !active.includes(plugin)
		);
		for (const plugin of activated) {
			wpCli(`plugin activate ${plugin}`);
		}
	});

	test.afterAll(() => {
		for (const plugin of activated) {
			wpCli(`plugin deactivate ${plugin}`);
		}
	});

	test('finds documented examples for every block plugin', () => {
		const plugins = new Set(cases.map((item) => item.plugin));
		for (const plugin of [
			'fair-events',
			'fair-audience',
			'fair-form',
			'fair-timetable',
			'fair-payments-connector',
			'fair-calendar-button',
		]) {
			expect(plugins, `${plugin} has generated block-docs`).toContain(
				plugin
			);
		}
	});

	for (const item of cases) {
		test(`${item.label}: ${item.example.name} example`, async ({
			page,
			seedEvent,
		}) => {
			await login(page);

			let postId;
			let permalink;
			let createdPage = false;
			let seed = null;
			const content = (markup) =>
				substituteIds(markup, item.example, seed);

			let venueId = null;
			if (item.example.syntheticIds?.venueId) {
				const venue = await apiFetch(page, {
					path: '/fair-events/v1/venues',
					method: 'POST',
					data: {
						name: `Block docs venue ${Date.now()}`,
						address: '1 Example Street',
					},
				});
				venueId = venue.id;
				seed = { venueId };
			}

			if (
				item.example.context === 'event' ||
				item.example.context === 'recurring-event'
			) {
				// A recurring example needs a series with upcoming sessions.
				const flavour =
					item.example.context === 'recurring-event'
						? 'multiple-instances'
						: 'paid';
				seed = { ...seedEvent(flavour), ...seed };
				postId = seed.eventId;
				await apiFetch(page, {
					path: `/wp/v2/fair_event/${postId}`,
					method: 'POST',
					data: { content: content(item.markup) },
				});
				permalink = seed.pageUrl;
			} else {
				const created = await apiFetch(page, {
					path: '/wp/v2/pages',
					method: 'POST',
					data: {
						title: `Block docs: ${item.label} ${item.example.name}`,
						status: 'publish',
						content: content(item.markup),
					},
				});
				postId = created.id;
				permalink = created.link;
				createdPage = true;
			}

			try {
				if (item.editor) {
					const loaded = await openAndInspect(page, postId);
					expect(loaded.problems, 'blocks valid on load').toEqual([]);

					await savePost(page);

					const reopened = await openAndInspect(page, postId);
					expect(
						reopened.problems,
						'blocks valid after save and reopen'
					).toEqual([]);
					expect(reopened.names, 'same blocks after save').toEqual(
						loaded.names
					);
				}

				await page.goto(permalink);
				await expect(
					page.locator(item.example.frontendSelector).first(),
					`frontend renders ${item.example.frontendSelector}`
				).toBeAttached();
			} finally {
				if (createdPage || venueId) {
					await page.goto('/wp-admin/');
				}
				if (createdPage) {
					await apiFetch(page, {
						path: `/wp/v2/pages/${postId}?force=true`,
						method: 'DELETE',
					});
				}
				if (venueId) {
					await apiFetch(page, {
						path: `/fair-events/v1/venues/${venueId}`,
						method: 'DELETE',
					});
				}
			}
		});
	}
});
