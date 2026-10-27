#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO = {
	title: 'Fair Events Plugins: Demo',
	adminUser: 'admin',
	adminPassword: 'password',
	email: 'marcin.wosinek@gmail.com',
	extraLocale: 'es_ES',
	activePlugin: 'fair-events',
};

export const ACKNOWLEDGE_FLAG = '--acknowledge-reset';
const RESET_COMMAND = `npm run demo:reset -- ${ACKNOWLEDGE_FLAG}`;

const WORDPRESS_ROOT = '/var/www/html';
const PLUGINS_ROOT = `${WORDPRESS_ROOT}/wp-content/plugins/`;
const SAFETY_PLUGIN = 'scripts/demo/fair-demo-safety.php';
const WWW_DATA = '33:33';
const PROVISIONING_FLAG = 'wp-content/fair-demo-provisioning.flag';
// The Compose volumes this script may delete, keyed by the service that
// mounts each one and the path it must be mounted at.
const DATA_VOLUMES = {
	wordpress: { service: 'wordpress', target: WORDPRESS_ROOT },
	db: { service: 'db', target: '/var/lib/mysql' },
};
// Without these the demo cannot activate Fair Events.
const REQUIRED_ARTIFACTS = [
	'fair-events/build',
	'fair-events/vendor/autoload.php',
];

export const DEFAULT_TIMING = { attempts: 90, intervalMs: 2000 };

export const USAGE = `Usage: ${RESET_COMMAND}

Deletes this checkout's Docker Compose WordPress and database volumes and
installs a fresh "${DEMO.title}" site on http://localhost:8080
(admin / password, English with Spanish available). Repository files,
images, other Compose projects and wp-env instances are kept.`;

export class ResetError extends Error {
	constructor(stage, message, { details = '', exitCode = 1 } = {}) {
		super(message);
		this.stage = stage;
		this.details = details;
		this.exitCode = exitCode;
	}
}

// A refusal before anything was deleted.
function refuse(stage, message, details) {
	return new ResetError(stage, message, { details, exitCode: 2 });
}

export function parseArguments(args) {
	let acknowledged = false;
	let help = false;
	for (const argument of args) {
		if (argument === ACKNOWLEDGE_FLAG) {
			acknowledged = true;
		} else if (argument === '--help' || argument === '-h') {
			help = true;
		} else if (argument !== '--') {
			throw new Error(`Unknown option "${argument}".\n\n${USAGE}`);
		}
	}
	return { acknowledged, help };
}

// Compose's own default project name for a directory, so `.env` or a
// COMPOSE_PROJECT_NAME in the shell can never point the reset elsewhere.
export function defaultProjectName(directory) {
	return basename(directory)
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, '')
		.replace(/^[^a-z0-9]+/, '');
}

export function isLocalDockerHost(host) {
	return /^(unix|npipe):\/\//.test(host);
}

// Compose options and env vars other than the explicit ones below would change
// which file, project or services the reset acts on.
export function childEnvironment(env) {
	return Object.fromEntries(
		Object.entries(env).filter(([key]) => !key.startsWith('COMPOSE_'))
	);
}

export function createProcessExecutor({ cwd, env }) {
	return {
		run(command, args, { capture = true, input } = {}) {
			return new Promise((resolve) => {
				const child = spawn(command, args, {
					cwd,
					env,
					stdio: [
						input === undefined ? 'ignore' : 'pipe',
						capture ? 'pipe' : 'inherit',
						capture ? 'pipe' : 'inherit',
					],
				});
				let stdout = '';
				let stderr = '';
				child.stdout?.on('data', (chunk) => (stdout += chunk));
				child.stderr?.on('data', (chunk) => (stderr += chunk));
				child.on('error', (error) =>
					resolve({
						code: error.code === 'ENOENT' ? 127 : 1,
						stdout,
						stderr: error.message,
					})
				);
				child.on('exit', (code) =>
					resolve({ code: code ?? 1, stdout, stderr })
				);
				if (input !== undefined) {
					child.stdin.end(input);
				}
			});
		},
	};
}

function lastLines(text, count = 15) {
	return text.trim().split('\n').slice(-count).join('\n');
}

// Checks the resolved Compose file is the repository's demo stack and returns
// what the reset needs from it.
export function validateComposeConfig(config, projectName) {
	const stage = 'Compose configuration';
	const problems = [];

	if (config.name !== projectName) {
		problems.push(
			`project name is "${config.name}", expected "${projectName}"`
		);
	}
	for (const service of ['wordpress', 'db', 'wpcli']) {
		if (!config.services?.[service]) {
			problems.push(`service "${service}" is missing`);
		}
	}
	if (problems.length) {
		throw refuse(
			stage,
			'compose.yml is not the expected demo stack.',
			problems.join('\n')
		);
	}

	const volumes = {};
	for (const [key, { service, target }] of Object.entries(DATA_VOLUMES)) {
		const mounts = (config.services[service].volumes ?? []).filter(
			(mount) => mount.target === target
		);
		if (
			mounts.length !== 1 ||
			mounts[0].type !== 'volume' ||
			mounts[0].source !== key
		) {
			problems.push(
				`${service} must mount only the "${key}" named volume at ${target}`
			);
			continue;
		}
		const definition = config.volumes?.[key];
		const expectedName = `${projectName}_${key}`;
		if (!definition || definition.external) {
			problems.push(
				`volume "${key}" must be a project volume, not external`
			);
		} else if (definition.name !== expectedName) {
			problems.push(
				`volume "${key}" resolves to "${definition.name}", expected "${expectedName}"`
			);
		} else if (definition.driver && definition.driver !== 'local') {
			problems.push(`volume "${key}" uses driver "${definition.driver}"`);
		} else if (
			definition.driver_opts &&
			Object.keys(definition.driver_opts).length
		) {
			problems.push(`volume "${key}" has driver options`);
		} else {
			volumes[key] = expectedName;
		}
	}

	const wordpress = config.services.wordpress;
	const bindSources = Object.values(config.services).flatMap((service) =>
		(service.volumes ?? [])
			.filter((mount) => mount.type === 'bind')
			.map((mount) => mount.source)
	);
	const plugins = (wordpress.volumes ?? [])
		.filter(
			(mount) =>
				mount.type === 'bind' && mount.target.startsWith(PLUGINS_ROOT)
		)
		.map((mount) => mount.target.slice(PLUGINS_ROOT.length));
	if (!plugins.includes(DEMO.activePlugin)) {
		problems.push(
			`wordpress does not mount the ${DEMO.activePlugin} plugin`
		);
	}

	const httpPort = (wordpress.ports ?? []).find(
		(port) => Number(port.target) === 80
	)?.published;
	if (!httpPort) {
		problems.push('wordpress does not publish port 80');
	}
	const publishedPorts = Object.values(config.services).flatMap((service) =>
		(service.ports ?? []).map((port) => String(port.published))
	);

	const database = config.services.db.environment ?? {};
	if (!database.MYSQL_USER || !database.MYSQL_PASSWORD) {
		problems.push('db does not define MYSQL_USER and MYSQL_PASSWORD');
	}

	if (problems.length) {
		throw refuse(
			stage,
			'compose.yml is not the expected demo stack.',
			problems.join('\n')
		);
	}

	return {
		volumes,
		plugins,
		bindSources,
		publishedPorts,
		siteUrl: `http://localhost:${httpPort}`,
		database: {
			user: database.MYSQL_USER,
			password: database.MYSQL_PASSWORD,
		},
	};
}

// A PHP snippet for `wp eval` that reports the settings the baseline must have.
function baselineProbe() {
	const user = JSON.stringify(DEMO.adminUser);
	const password = JSON.stringify(DEMO.adminPassword);
	return `global $wpdb;
$user = get_user_by( 'login', ${user} );
echo wp_json_encode( array(
	'title' => get_option( 'blogname' ),
	'admin_email' => get_option( 'admin_email' ),
	'home' => home_url(),
	'user_email' => $user ? $user->user_email : null,
	'is_admin' => $user && user_can( $user, 'manage_options' ),
	'password_ok' => $user && wp_check_password( ${password}, $user->user_pass, $user->ID ),
	'locale' => get_locale(),
	'user_locale' => $user ? get_user_locale( $user ) : null,
	'languages' => get_available_languages(),
	'active_plugins' => get_option( 'active_plugins' ),
	'posts' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts}" ),
	'comments' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->comments}" ),
) );`;
}

export function baselineProblems(state, siteUrl) {
	const expected = {
		title: DEMO.title,
		admin_email: DEMO.email,
		home: siteUrl,
		user_email: DEMO.email,
		is_admin: true,
		password_ok: true,
		locale: 'en_US',
		user_locale: 'en_US',
		posts: 0,
		comments: 0,
	};
	const problems = Object.entries(expected)
		.filter(([key, value]) => state[key] !== value)
		.map(
			([key, value]) =>
				`${key} is ${JSON.stringify(state[key])}, expected ${JSON.stringify(value)}`
		);
	if (!state.languages?.includes(DEMO.extraLocale)) {
		problems.push(`${DEMO.extraLocale} is not installed`);
	}
	const activePlugin = `${DEMO.activePlugin}/${DEMO.activePlugin}.php`;
	if (
		JSON.stringify(state.active_plugins) !== JSON.stringify([activePlugin])
	) {
		problems.push(
			`active plugins are ${JSON.stringify(state.active_plugins)}, expected only ${activePlugin}`
		);
	}
	return problems;
}

async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function defaultSleep(milliseconds) {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function resetDemo({
	options,
	rootDirectory,
	executor,
	env = process.env,
	fetchImpl = fetch,
	exists = pathExists,
	readText = (path) => readFile(path, 'utf8'),
	sleep = defaultSleep,
	timing = DEFAULT_TIMING,
	logger = console.log,
	errorLogger = console.error,
}) {
	if (options.help) {
		logger(USAGE);
		return 0;
	}
	if (!options.acknowledged) {
		errorLogger(
			`Refusing to reset without ${ACKNOWLEDGE_FLAG}. Nothing was changed.\n\n${USAGE}`
		);
		return 2;
	}

	const projectName = defaultProjectName(rootDirectory);
	const composeFile = join(rootDirectory, 'compose.yml');
	const compose = (...args) => [
		'compose',
		'--project-directory',
		rootDirectory,
		'-f',
		composeFile,
		'-p',
		projectName,
		...args,
	];
	const docker = (args, runOptions) =>
		executor.run('docker', args, runOptions);
	// The wordpress:cli image runs as uid 82, but the files belong to the
	// WordPress image's www-data (33); as 82, language installs cannot write.
	const wp = (args, runOptions) =>
		docker(
			compose('exec', '-T', '-u', WWW_DATA, 'wpcli', 'wp', ...args),
			runOptions
		);
	const inWordpress = (script, runOptions) =>
		docker(
			compose(
				'exec',
				'-T',
				'-w',
				WORDPRESS_ROOT,
				'wordpress',
				'sh',
				'-c',
				script
			),
			runOptions
		);
	const phase = (message) => logger(`\n==> ${message}`);
	const waitFor = async (check) => {
		let result;
		for (let attempt = 1; attempt <= timing.attempts; attempt++) {
			result = await check();
			if (result.ok) {
				return result;
			}
			if (attempt < timing.attempts) {
				await sleep(timing.intervalMs);
			}
		}
		return result;
	};
	const timedOut = (stage, what, details = '') =>
		new ResetError(
			stage,
			`${what} within ${(timing.attempts * timing.intervalMs) / 1000} seconds.`,
			{ details }
		);
	// Runs a step that must succeed, failing the stage with its output.
	const must = async (stage, message, resultPromise) => {
		const result = await resultPromise;
		if (result.code !== 0) {
			throw new ResetError(stage, message, {
				details: lastLines(
					`${result.stdout ?? ''}\n${result.stderr ?? ''}`
				),
			});
		}
		return result;
	};

	let siteUrl;
	try {
		phase('Checking prerequisites');
		const stage = 'prerequisites';
		if (env.DOCKER_HOST && !isLocalDockerHost(env.DOCKER_HOST)) {
			throw refuse(
				stage,
				`DOCKER_HOST points to a remote engine (${env.DOCKER_HOST}). Unset it to reset the local demo.`
			);
		}
		const version = await docker([
			'version',
			'--format',
			'{{.Server.Version}}',
		]);
		if (version.code === 127) {
			throw refuse(
				stage,
				'Docker is not installed or not on PATH. Install Docker Desktop or Docker Engine with Compose v2.'
			);
		}
		if (version.code !== 0) {
			throw refuse(
				stage,
				'Cannot reach the Docker daemon. Start Docker and check that your user may access it.',
				lastLines(version.stderr)
			);
		}
		if ((await docker(['compose', 'version', '--short'])).code !== 0) {
			throw refuse(
				stage,
				'Docker Compose v2 (`docker compose`) is not available.'
			);
		}
		const context = await docker([
			'context',
			'inspect',
			'--format',
			'{{.Endpoints.docker.Host}}',
		]);
		const contextHost = context.stdout.trim();
		if (context.code !== 0 || !isLocalDockerHost(contextHost)) {
			throw refuse(
				stage,
				`The current Docker context is not a local engine (${contextHost || 'unknown'}). Switch with \`docker context use default\`.`
			);
		}
		const missingArtifacts = [];
		for (const artifact of REQUIRED_ARTIFACTS) {
			if (!(await exists(join(rootDirectory, artifact)))) {
				missingArtifacts.push(artifact);
			}
		}
		if (missingArtifacts.length) {
			throw refuse(
				stage,
				'Fair Events is not built. Run `npm install`, `npm run build -w fair-events` and `npm run composer:install`, then retry.',
				`Missing: ${missingArtifacts.join(', ')}`
			);
		}
		const safetyPlugin = await readText(join(rootDirectory, SAFETY_PLUGIN));

		phase('Checking the Compose project');
		const configResult = await docker(
			compose('config', '--format', 'json')
		);
		if (configResult.code !== 0) {
			throw refuse(
				'Compose configuration',
				'compose.yml could not be resolved.',
				lastLines(configResult.stderr)
			);
		}
		const stack = validateComposeConfig(
			JSON.parse(configResult.stdout),
			projectName
		);
		siteUrl = stack.siteUrl;
		const missingSources = [];
		for (const source of stack.bindSources) {
			if (!(await exists(source))) {
				missingSources.push(source);
			}
		}
		if (missingSources.length) {
			throw refuse(
				'Compose configuration',
				'Mounted repository paths are missing; Docker would create them as empty directories.',
				missingSources.join('\n')
			);
		}

		const existingVolumes = [];
		for (const [key, name] of Object.entries(stack.volumes)) {
			const inspect = await docker([
				'volume',
				'inspect',
				name,
				'--format',
				'{{json .}}',
			]);
			if (inspect.code !== 0) {
				if (/no such volume/i.test(inspect.stderr)) {
					continue;
				}
				throw refuse(
					'data volumes',
					`Could not inspect volume ${name}.`,
					lastLines(inspect.stderr)
				);
			}
			const volume = JSON.parse(inspect.stdout);
			const labels = volume.Labels ?? {};
			if (
				labels['com.docker.compose.project'] !== projectName ||
				labels['com.docker.compose.volume'] !== key ||
				volume.Driver !== 'local' ||
				Object.keys(volume.Options ?? {}).length
			) {
				throw refuse(
					'data volumes',
					`Volume ${name} was not created by Compose project "${projectName}"; refusing to delete it.`,
					`Driver: ${volume.Driver}, labels: ${JSON.stringify(labels)}, options: ${JSON.stringify(volume.Options)}`
				);
			}
			existingVolumes.push(name);
		}

		const conflicts = [];
		for (const port of stack.publishedPorts) {
			const owners = await docker([
				'ps',
				'--filter',
				`publish=${port}`,
				'--format',
				'{{.Names}}\t{{.Label "com.docker.compose.project"}}',
			]);
			for (const line of owners.stdout.split('\n').filter(Boolean)) {
				const [container, project] = line.split('\t');
				if (project !== projectName) {
					conflicts.push(`port ${port}: ${container}`);
				}
			}
		}
		if (conflicts.length) {
			throw refuse(
				'ports',
				'Another container publishes a port the demo needs. Stop it (for example `docker compose stop` in that checkout) and retry.',
				conflicts.join('\n')
			);
		}

		phase(`Removing the ${projectName} containers and data volumes`);
		await must(
			'reset',
			'Could not stop the demo containers.',
			docker(compose('down'), { capture: false })
		);
		if (existingVolumes.length) {
			await must(
				'reset',
				'Could not remove the demo data volumes.',
				docker(['volume', 'rm', ...existingVolumes])
			);
		}

		phase('Starting WordPress and its database');
		await must(
			'startup',
			`Could not start the demo containers. Check that ${stack.siteUrl} and the other published ports are free.`,
			docker(compose('up', '-d'), { capture: false })
		);

		phase('Waiting for the database');
		let last = await waitFor(async () => {
			const result = await docker(
				compose(
					'exec',
					'-T',
					'-e',
					`MYSQL_PWD=${stack.database.password}`,
					'db',
					'mysqladmin',
					'ping',
					'-h',
					'127.0.0.1',
					'-u',
					stack.database.user,
					'--silent'
				)
			);
			return { ok: result.code === 0, result };
		});
		if (!last.ok) {
			throw timedOut(
				'database readiness',
				'The database did not accept connections',
				lastLines(last.result.stderr)
			);
		}

		phase('Waiting for WordPress files and configuration');
		last = await waitFor(async () => {
			const result = await inWordpress(
				'test -f wp-config.php && test -f wp-includes/version.php'
			);
			return { ok: result.code === 0, result };
		});
		if (!last.ok) {
			throw timedOut(
				'WordPress files',
				'The WordPress container did not populate wp-config.php',
				lastLines(last.result.stderr)
			);
		}

		phase('Installing the demo safety plugin');
		await must(
			'safety plugin',
			'Could not prepare wp-content.',
			inWordpress(
				`mkdir -p wp-content/mu-plugins && touch ${PROVISIONING_FLAG} && chown ${WWW_DATA} wp-content/mu-plugins ${PROVISIONING_FLAG}`
			)
		);
		await must(
			'safety plugin',
			'Could not install the demo safety plugin.',
			inWordpress('cat > wp-content/mu-plugins/fair-demo-safety.php', {
				input: safetyPlugin,
			})
		);

		phase(`Waiting for ${stack.siteUrl}`);
		last = await waitFor(async () => {
			try {
				const response = await fetchImpl(
					`${stack.siteUrl}/wp-login.php`,
					{
						redirect: 'manual',
					}
				);
				return {
					ok: response.status < 500,
					detail: `HTTP ${response.status}`,
				};
			} catch (error) {
				return {
					ok: false,
					detail: error.cause?.message ?? error.message,
				};
			}
		});
		if (!last.ok) {
			throw timedOut(
				'HTTP readiness',
				`${stack.siteUrl} did not respond`,
				last.detail
			);
		}

		phase('Installing WordPress');
		await must(
			'installation',
			'WordPress installation failed.',
			wp([
				'core',
				'install',
				`--url=${stack.siteUrl}`,
				`--title=${DEMO.title}`,
				`--admin_user=${DEMO.adminUser}`,
				`--admin_password=${DEMO.adminPassword}`,
				`--admin_email=${DEMO.email}`,
				'--skip-email',
			])
		);
		for (const args of [
			['rewrite', 'structure', '/%postname%/'],
			['site', 'empty', '--yes'],
			['option', 'update', 'wp_page_for_privacy_policy', '0'],
		]) {
			await must(
				'installation',
				`\`wp ${args.join(' ')}\` failed.`,
				wp(args)
			);
		}

		phase(`Installing ${DEMO.extraLocale} language packs`);
		for (const args of [
			['language', 'core', 'install', DEMO.extraLocale],
			['language', 'theme', 'install', '--all', DEMO.extraLocale],
		]) {
			await must(
				'languages',
				`Could not install the ${DEMO.extraLocale} language packs from WordPress.org. Check the network connection and retry.`,
				wp(args)
			);
		}

		phase(`Activating ${DEMO.activePlugin}`);
		const pluginList = await must(
			'plugins',
			'Could not list plugins.',
			wp(['plugin', 'list', '--field=name', '--format=json'])
		);
		const available = JSON.parse(pluginList.stdout);
		const undiscovered = stack.plugins.filter(
			(plugin) => !available.includes(plugin)
		);
		if (undiscovered.length) {
			throw new ResetError(
				'plugins',
				'Mounted project plugins are not discoverable by WordPress.',
				{ details: undiscovered.join('\n') }
			);
		}
		await must(
			'plugins',
			`Could not activate ${DEMO.activePlugin}.`,
			wp(['plugin', 'activate', DEMO.activePlugin])
		);

		phase('Verifying the baseline');
		const probe = await must(
			'verification',
			'Could not read the installed settings.',
			wp(['eval', baselineProbe()])
		);
		const problems = baselineProblems(
			JSON.parse(probe.stdout),
			stack.siteUrl
		);
		if (problems.length) {
			throw new ResetError(
				'verification',
				'The installed site does not match the demo baseline.',
				{ details: problems.join('\n') }
			);
		}
		const login = await fetchImpl(`${stack.siteUrl}/wp-login.php`, {
			method: 'POST',
			redirect: 'manual',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Cookie: 'wordpress_test_cookie=WP%20Cookie%20check',
			},
			body: new URLSearchParams({
				log: DEMO.adminUser,
				pwd: DEMO.adminPassword,
				testcookie: '1',
				redirect_to: `${stack.siteUrl}/wp-admin/`,
			}).toString(),
		});
		const cookies = login.headers.getSetCookie?.() ?? [];
		if (
			login.status !== 302 ||
			!cookies.some((cookie) => cookie.startsWith('wordpress_logged_in_'))
		) {
			throw new ResetError(
				'verification',
				`Logging in as ${DEMO.adminUser} failed (HTTP ${login.status}).`
			);
		}
		await must(
			'verification',
			'Could not re-enable cron.',
			inWordpress(`rm -f ${PROVISIONING_FLAG}`)
		);
	} catch (error) {
		if (!(error instanceof ResetError)) {
			throw error;
		}
		errorLogger(`\nDemo reset failed at ${error.stage}: ${error.message}`);
		if (error.details) {
			errorLogger(error.details);
		}
		errorLogger(
			error.exitCode === 2
				? 'Nothing was changed.'
				: `The demo is incomplete. Fix the cause and rerun \`${RESET_COMMAND}\`; it starts again from empty volumes.`
		);
		return error.exitCode;
	}

	logger(`\nDemo ready.
  Site:  ${siteUrl}/
  Login: ${siteUrl}/wp-login.php (${DEMO.adminUser} / ${DEMO.adminPassword})`);
	return 0;
}

async function main() {
	let options;
	try {
		options = parseArguments(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
		return;
	}
	const rootDirectory = fileURLToPath(new URL('..', import.meta.url)).replace(
		/\/$/,
		''
	);
	process.exitCode = await resetDemo({
		options,
		rootDirectory,
		executor: createProcessExecutor({
			cwd: rootDirectory,
			env: childEnvironment(process.env),
		}),
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
