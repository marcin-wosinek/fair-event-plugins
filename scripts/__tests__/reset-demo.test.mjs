import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ACKNOWLEDGE_FLAG,
	DEMO,
	childEnvironment,
	defaultProjectName,
	parseArguments,
	resetDemo,
} from '../reset-demo.mjs';

const ROOT = '/work/fair-event-plugins';
const PROJECT = 'fair-event-plugins';

function composeConfig(overrides = {}) {
	const plugin = (name) => ({
		type: 'bind',
		source: `${ROOT}/${name}`,
		target: `/var/www/html/wp-content/plugins/${name}`,
	});
	return {
		name: PROJECT,
		services: {
			wordpress: {
				ports: [{ target: 80, published: '8080' }],
				volumes: [
					{
						type: 'volume',
						source: 'wordpress',
						target: '/var/www/html',
					},
					plugin('fair-events'),
					plugin('fair-audience'),
				],
			},
			db: {
				ports: [{ target: 3306, published: '3306' }],
				environment: { MYSQL_USER: 'user', MYSQL_PASSWORD: 'pass' },
				volumes: [
					{ type: 'volume', source: 'db', target: '/var/lib/mysql' },
				],
			},
			wpcli: {
				volumes: [
					{
						type: 'volume',
						source: 'wordpress',
						target: '/var/www/html',
					},
				],
			},
		},
		volumes: {
			wordpress: { name: `${PROJECT}_wordpress` },
			db: { name: `${PROJECT}_db` },
		},
		...overrides,
	};
}

function volume(key, labels = {}) {
	return {
		code: 0,
		stdout: JSON.stringify({
			Driver: 'local',
			Options: null,
			Labels: {
				'com.docker.compose.project': PROJECT,
				'com.docker.compose.volume': key,
				...labels,
			},
		}),
	};
}

function baseline(overrides = {}) {
	return {
		title: DEMO.title,
		admin_email: DEMO.email,
		home: 'http://localhost:8080',
		user_email: DEMO.email,
		is_admin: true,
		password_ok: true,
		locale: 'en_US',
		user_locale: 'en_US',
		languages: ['es_ES'],
		active_plugins: ['fair-events/fair-events.php'],
		posts: 0,
		comments: 0,
		...overrides,
	};
}

// Answers docker calls by the first matching rule; a rule's pattern is matched
// against the joined arguments with the compose prefix removed.
function createExecutor(rules = []) {
	const calls = [];
	const defaults = [
		[
			/^context inspect/,
			{ code: 0, stdout: 'unix:///var/run/docker.sock\n' },
		],
		[
			/^compose config/,
			{ code: 0, stdout: JSON.stringify(composeConfig()) },
		],
		[/^volume inspect \S+_wordpress/, volume('wordpress')],
		[/^volume inspect \S+_db/, volume('db')],
		[/^ps /, { code: 0, stdout: `${PROJECT}-wordpress-1\t${PROJECT}\n` }],
		[
			/^compose exec -T -u 33:33 wpcli wp plugin list/,
			{
				code: 0,
				stdout: JSON.stringify([
					'akismet',
					'fair-events',
					'fair-audience',
				]),
			},
		],
		[
			/^compose exec -T -u 33:33 wpcli wp eval/,
			{
				code: 0,
				stdout: JSON.stringify(baseline()),
			},
		],
	];
	return {
		calls,
		async run(command, args, options) {
			const prefix = [
				'compose',
				'--project-directory',
				ROOT,
				'-f',
				`${ROOT}/compose.yml`,
				'-p',
				PROJECT,
			];
			const stripped = prefix.every((part, index) => args[index] === part)
				? ['compose', ...args.slice(prefix.length)]
				: args;
			const key = stripped.join(' ');
			calls.push({ command, key, options });
			for (const [pattern, response] of [...rules, ...defaults]) {
				if (pattern.test(key)) {
					return typeof response === 'function'
						? response()
						: response;
				}
			}
			return { code: 0, stdout: '', stderr: '' };
		},
	};
}

function loginResponse({
	status = 302,
	cookies = ['wordpress_logged_in_abc=1; path=/'],
} = {}) {
	return {
		status,
		headers: { getSetCookie: () => cookies },
	};
}

async function run(executor, overrides = {}) {
	const output = [];
	const code = await resetDemo({
		options: { acknowledged: true, help: false },
		rootDirectory: ROOT,
		executor,
		env: {},
		fetchImpl: async (url, init) =>
			init?.method === 'POST' ? loginResponse() : { status: 302 },
		exists: async () => true,
		readText: async () => '<?php // safety',
		sleep: async () => {},
		timing: { attempts: 3, intervalMs: 0 },
		logger: (line) => output.push(line),
		errorLogger: (line) => output.push(line),
		...overrides,
	});
	return { code, output: output.join('\n') };
}

const isMutation = ({ key }) => /^compose (down|up)|^volume rm|prune/.test(key);

test('parseArguments requires nothing but accepts the acknowledgement flag', () => {
	assert.deepEqual(parseArguments([]), { acknowledged: false, help: false });
	assert.deepEqual(parseArguments(['--', ACKNOWLEDGE_FLAG]), {
		acknowledged: true,
		help: false,
	});
	assert.throws(() => parseArguments(['--yes']), /Unknown option "--yes"/);
});

test('project name follows Compose, and child processes drop COMPOSE_ variables', () => {
	assert.equal(
		defaultProjectName('/x/Fair-Event-Plugins.Secondary'),
		'fair-event-pluginssecondary'
	);
	assert.deepEqual(
		childEnvironment({
			PATH: '/bin',
			COMPOSE_PROJECT_NAME: 'other',
			COMPOSE_FILE: 'x.yml',
		}),
		{ PATH: '/bin' }
	);
});

test('without acknowledgement nothing runs', async () => {
	const executor = createExecutor();
	const { code, output } = await run(executor, {
		options: { acknowledged: false, help: false },
	});
	assert.equal(code, 2);
	assert.equal(executor.calls.length, 0);
	assert.match(output, /Refusing to reset without --acknowledge-reset/);
});

test('success removes exactly the two project volumes and reports the site', async () => {
	const executor = createExecutor();
	const { code, output } = await run(executor);
	assert.equal(code, 0, output);

	const keys = executor.calls.map(({ key }) => key);
	assert.deepEqual(
		keys.filter((key) => isMutation({ key })),
		[
			'compose down',
			`volume rm ${PROJECT}_wordpress ${PROJECT}_db`,
			'compose up -d',
		]
	);
	assert.ok(
		!keys.some((key) =>
			/prune|down .*-v|--volumes|--remove-orphans/.test(key)
		)
	);
	assert.ok(
		keys.some(
			(key) =>
				key.includes('core install') &&
				key.includes(`--title=${DEMO.title}`)
		)
	);
	assert.ok(keys.some((key) => key.includes('language core install es_ES')));
	assert.ok(
		keys.includes(
			'compose exec -T -u 33:33 wpcli wp plugin activate fair-events'
		)
	);
	assert.ok(
		keys.at(-1).includes('rm -f wp-content/fair-demo-provisioning.flag')
	);
	assert.match(
		output,
		/Demo ready\.\n {2}Site: {2}http:\/\/localhost:8080\//
	);
});

test('an empty environment has no volumes to remove', async () => {
	const missing = { code: 1, stdout: '', stderr: 'Error: No such volume: x' };
	const executor = createExecutor([[/^volume inspect/, missing]]);
	assert.equal((await run(executor)).code, 0);
	assert.ok(!executor.calls.some(({ key }) => key.startsWith('volume rm')));
});

for (const [name, rules, overrides, message] of [
	[
		'Docker missing',
		[
			[
				/^version/,
				{ code: 127, stdout: '', stderr: 'spawn docker ENOENT' },
			],
		],
		{},
		/Docker is not installed/,
	],
	[
		'daemon unreachable',
		[
			[
				/^version/,
				{
					code: 1,
					stdout: '',
					stderr: 'Cannot connect to the Docker daemon',
				},
			],
		],
		{},
		/Cannot reach the Docker daemon/,
	],
	[
		'remote DOCKER_HOST',
		[],
		{ env: { DOCKER_HOST: 'tcp://10.0.0.5:2376' } },
		/remote engine/,
	],
	[
		'remote context',
		[[/^context inspect/, { code: 0, stdout: 'ssh://user@server\n' }]],
		{},
		/not a local engine/,
	],
	[
		'unbuilt Fair Events',
		[],
		{ exists: async (path) => !path.endsWith('fair-events/build') },
		/Fair Events is not built[\s\S]*Missing: fair-events\/build/,
	],
	[
		'unexpected project name',
		[
			[
				/^compose config/,
				{
					code: 0,
					stdout: JSON.stringify(composeConfig({ name: 'other' })),
				},
			],
		],
		{},
		/project name is "other"/,
	],
	[
		'external volume',
		[
			[
				/^compose config/,
				{
					code: 0,
					stdout: JSON.stringify(
						composeConfig({
							volumes: {
								wordpress: { name: 'shared', external: true },
								db: { name: `${PROJECT}_db` },
							},
						})
					),
				},
			],
		],
		{},
		/volume "wordpress" must be a project volume/,
	],
	[
		'bind mount replacing the database volume',
		[
			[
				/^compose config/,
				() => {
					const config = composeConfig();
					config.services.db.volumes = [
						{
							type: 'bind',
							source: '/data',
							target: '/var/lib/mysql',
						},
					];
					return { code: 0, stdout: JSON.stringify(config) };
				},
			],
		],
		{},
		/db must mount only the "db" named volume/,
	],
	[
		'volume owned by another project',
		[
			[
				/^volume inspect \S+_db/,
				volume('db', { 'com.docker.compose.project': 'elsewhere' }),
			],
		],
		{},
		/was not created by Compose project "fair-event-plugins"/,
	],
	[
		'port held by another project',
		[
			[
				/^ps .*publish=8080/,
				{ code: 0, stdout: 'main-wordpress-1\tmain\n' },
			],
		],
		{},
		/Another container publishes[\s\S]*port 8080: main-wordpress-1/,
	],
]) {
	test(`refuses without changes: ${name}`, async () => {
		const executor = createExecutor(rules);
		const { code, output } = await run(executor, overrides);
		assert.equal(code, 2, output);
		assert.match(output, message);
		assert.match(output, /Nothing was changed\./);
		assert.ok(!executor.calls.some(isMutation));
		assert.doesNotMatch(output, /Demo ready/);
	});
}

for (const [name, rules, overrides, message] of [
	[
		'database never ready',
		[[/mysqladmin ping/, { code: 1, stdout: '', stderr: "Can't connect" }]],
		{},
		/failed at database readiness: The database did not accept connections within 0 seconds\.\nCan't connect/,
	],
	[
		'HTTP never ready',
		[],
		{
			fetchImpl: async () => {
				throw new Error('ECONNREFUSED');
			},
		},
		/failed at HTTP readiness: http:\/\/localhost:8080 did not respond[\s\S]*ECONNREFUSED/,
	],
	[
		'container startup fails',
		[[/^compose up/, { code: 1, stdout: '', stderr: '' }]],
		{},
		/failed at startup: Could not start the demo containers/,
	],
	[
		'language download fails',
		[
			[
				/language core install/,
				{ code: 1, stdout: '', stderr: 'Error: Download failed.' },
			],
		],
		{},
		/failed at languages: Could not install the es_ES language packs[\s\S]*Download failed/,
	],
	[
		'language silently missing',
		[
			[
				/wp eval/,
				{
					code: 0,
					stdout: JSON.stringify(baseline({ languages: [] })),
				},
			],
		],
		{},
		/failed at verification[\s\S]*es_ES is not installed/,
	],
	[
		'unexpected settings',
		[
			[
				/wp eval/,
				{
					code: 0,
					stdout: JSON.stringify(
						baseline({ title: 'Old', posts: 3 })
					),
				},
			],
		],
		{},
		/title is "Old", expected "Fair Events Plugins: Demo"\nposts is 3, expected 0/,
	],
	[
		'mounted plugin not discovered',
		[
			[
				/wp plugin list/,
				{ code: 0, stdout: JSON.stringify(['fair-events']) },
			],
		],
		{},
		/failed at plugins: Mounted project plugins are not discoverable[\s\S]*fair-audience/,
	],
	[
		'login rejected',
		[],
		{
			fetchImpl: async (url, init) =>
				init?.method === 'POST'
					? loginResponse({ status: 200, cookies: [] })
					: { status: 302 },
		},
		/Logging in as admin failed \(HTTP 200\)/,
	],
]) {
	test(`fails with the stage and a recovery command: ${name}`, async () => {
		const executor = createExecutor(rules);
		const { code, output } = await run(executor, overrides);
		assert.equal(code, 1, output);
		assert.match(output, message);
		assert.match(
			output,
			/rerun `npm run demo:reset -- --acknowledge-reset`/
		);
		assert.doesNotMatch(output, /Demo ready/);
		assert.ok(
			!executor.calls.some(({ key }) =>
				key.includes('rm -f wp-content/fair-demo-provisioning.flag')
			),
			'cron stays paused after a failed reset'
		);
	});
}
