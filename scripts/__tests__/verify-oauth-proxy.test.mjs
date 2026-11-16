import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
	HEALTH_PATH,
	REFRESH_PATH,
	parseArgs,
	verifyProxy,
} from '../verify-oauth-proxy.mjs';

const SCRIPT = fileURLToPath(
	new URL('../verify-oauth-proxy.mjs', import.meta.url)
);
const BASE = 'https://proxy.example';

const json = (status, body) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=UTF-8' },
	});
const html = (status) =>
	new Response('<!doctype html><title>Home</title>', {
		status,
		headers: { 'content-type': 'text/html; charset=UTF-8' },
	});

const HEALTHY = () =>
	json(200, { service: 'fair-platform-oauth-proxy', status: 'ok' });
const REFRESH_OK = () =>
	json(400, { success: false, data: { message: 'Missing refresh_token' } });

/**
 * A fetch double answering each path from a table, recording requests.
 *
 * @param {Object} routes Path → response factory (or rejecting function).
 * @return {Function} Fetch with a `calls` list.
 */
function fakeFetch(routes) {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, init });
		const route = routes[new URL(url).pathname];
		return route(init);
	};
	fetch.calls = calls;
	return fetch;
}

const verify = (routes, options = {}) => {
	const fetch = fakeFetch(routes);
	return verifyProxy({
		baseUrl: BASE,
		fetch,
		attempts: 1,
		log: () => {},
		...options,
	}).then((result) => ({ ...result, calls: fetch.calls }));
};

test('a healthy proxy passes', async () => {
	const result = await verify({
		[HEALTH_PATH]: HEALTHY,
		[REFRESH_PATH]: REFRESH_OK,
	});
	assert.deepEqual(result.failures, []);
	assert.equal(result.ok, true);
});

test('the refresh probe sends no token and follows no redirect', async () => {
	const { calls } = await verify({
		[HEALTH_PATH]: HEALTHY,
		[REFRESH_PATH]: REFRESH_OK,
	});
	const refresh = calls.find((call) => call.url.endsWith(REFRESH_PATH));
	assert.equal(refresh.init.method, 'POST');
	assert.equal(refresh.init.body, '');
	assert.doesNotMatch(JSON.stringify(refresh.init.headers), /token/i);
	for (const call of calls) {
		assert.equal(call.init.redirect, 'manual');
	}
});

const BROKEN_HEALTH = {
	'a missing route (paused or inactive plugin)': [
		() => json(404, { code: 'rest_no_route', message: 'No route' }),
		/route is missing.*paused/,
	],
	'a redirect to the homepage': [
		() =>
			new Response(null, {
				status: 301,
				headers: { location: 'https://proxy.example/?secret=x' },
			}),
		/redirected \(HTTP 301\) to https:\/\/proxy\.example\/\. /,
	],
	'the homepage HTML': [() => html(200), /answered text\/html \(HTTP 200\)/],
	'an unhealthy proxy': [
		() =>
			json(503, {
				service: 'fair-platform-oauth-proxy',
				status: 'unhealthy',
			}),
		/reports unhealthy \(HTTP 503\).*MOLLIE_CLIENT_ID/,
	],
	'a host error page': [() => html(503), /answered text\/html \(HTTP 503\)/],
	'malformed JSON': [
		() =>
			new Response('{"service":', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		/malformed JSON/,
	],
	'some other JSON': [
		() => json(200, { status: 'ok' }),
		/without the proxy's service identifier/,
	],
	'a timeout': [
		(init) =>
			new Promise((resolve, reject) => {
				init.signal.addEventListener('abort', () =>
					reject(init.signal.reason)
				);
			}),
		/timed out after 20 ms/,
	],
	'a connection error': [
		() => {
			throw new TypeError('fetch failed', {
				cause: { code: 'ECONNREFUSED' },
			});
		},
		/request failed \(ECONNREFUSED\)/,
	],
};

for (const [name, [route, pattern]] of Object.entries(BROKEN_HEALTH)) {
	test(`health check fails on ${name}`, async () => {
		const result = await verify(
			{ [HEALTH_PATH]: route, [REFRESH_PATH]: REFRESH_OK },
			{ timeoutMs: 20 }
		);
		assert.equal(result.ok, false);
		assert.equal(result.failures.length, 1);
		assert.match(result.failures[0], pattern);
	});
}

const BROKEN_REFRESH = {
	'the homepage HTML': [() => html(200), /text\/html.*rewrite flush/],
	'a redirect': [
		() =>
			new Response(null, {
				status: 302,
				headers: { location: '/' },
			}),
		/redirected \(HTTP 302\)/,
	],
	'a different error': [
		() => json(400, { success: false, data: { message: 'Other' } }),
		/answered HTTP 400 instead/,
	],
	'a success': [
		() => json(200, { success: true }),
		/answered HTTP 200 instead/,
	],
};

for (const [name, [route, pattern]] of Object.entries(BROKEN_REFRESH)) {
	test(`refresh check fails on ${name}`, async () => {
		const result = await verify({
			[HEALTH_PATH]: HEALTHY,
			[REFRESH_PATH]: route,
		});
		assert.equal(result.ok, false);
		assert.equal(result.failures.length, 1);
		assert.match(result.failures[0], pattern);
	});
}

test('retries until the proxy answers, within the attempt budget', async () => {
	let healthCalls = 0;
	const sleeps = [];
	const result = await verify(
		{
			[HEALTH_PATH]: () => (++healthCalls < 3 ? html(200) : HEALTHY()),
			[REFRESH_PATH]: REFRESH_OK,
		},
		{ attempts: 3, delayMs: 5, sleep: async (ms) => sleeps.push(ms) }
	);
	assert.equal(result.ok, true);
	assert.equal(healthCalls, 3);
	assert.deepEqual(sleeps, [5, 5]);
});

test('reports the last attempt when every attempt fails', async () => {
	const result = await verify(
		{ [HEALTH_PATH]: () => html(200), [REFRESH_PATH]: () => html(200) },
		{ attempts: 2, sleep: async () => {} }
	);
	assert.equal(result.ok, false);
	assert.equal(result.failures.length, 2);
});

test('parses command-line options', () => {
	assert.deepEqual(parseArgs(['--url=https://proxy.example']), {
		baseUrl: 'https://proxy.example',
		attempts: 5,
		delayMs: 10000,
		timeoutMs: 15000,
	});
	assert.equal(
		parseArgs(['--url=https://proxy.example', '--attempts=2']).attempts,
		2
	);
	assert.throws(() => parseArgs([]), /--url/);
	assert.throws(
		() => parseArgs(['--url=https://proxy.example', '--attempts=0']),
		/--attempts/
	);
	assert.throws(() => parseArgs(['--verbose']), /Unknown argument/);
});

/**
 * Run the CLI against a local server answering each path.
 *
 * @param {Object} routes Path → [status, content type, body].
 * @return {Promise<{code: number, stderr: string}>} Exit status and errors.
 */
async function runCli(routes) {
	const server = createServer((request, response) => {
		const [status, type, body] = routes[request.url] || [
			404,
			'text/html',
			'<html></html>',
		];
		response.writeHead(status, { 'content-type': type });
		response.end(body);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	try {
		await promisify(execFile)(process.execPath, [
			SCRIPT,
			`--url=${url}`,
			'--attempts=1',
			'--timeout=2000',
		]);
		return { code: 0, stderr: '' };
	} catch (error) {
		return { code: error.code, stderr: error.stderr };
	} finally {
		server.close();
	}
}

test('the CLI exits 0 for a healthy proxy', async () => {
	const result = await runCli({
		[HEALTH_PATH]: [
			200,
			'application/json',
			JSON.stringify({
				service: 'fair-platform-oauth-proxy',
				status: 'ok',
			}),
		],
		[REFRESH_PATH]: [
			400,
			'application/json',
			JSON.stringify({
				success: false,
				data: { message: 'Missing refresh_token' },
			}),
		],
	});
	assert.deepEqual(result, { code: 0, stderr: '' });
});

test('the CLI exits nonzero when the proxy URLs fall through to the homepage', async () => {
	const result = await runCli({
		[HEALTH_PATH]: [200, 'text/html', '<html>Home</html>'],
		[REFRESH_PATH]: [200, 'text/html', '<html>Home</html>'],
	});
	assert.equal(result.code, 1);
	assert.match(result.stderr, /Health check/);
	assert.match(result.stderr, /Refresh check/);
});
