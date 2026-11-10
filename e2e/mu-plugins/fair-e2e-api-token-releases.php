<?php
/**
 * Plugin Name: Fair E2E API token release pairings
 * Description: Test-only. Lets ApiTokens.api.spec.js run one request as a
 *              mix of Fair Payments Connector and Experimental releases
 *              (#2080), without installing historical releases.
 *
 * A request opts in with headers; requests without them are untouched:
 *
 * - `X-Fair-E2E-Payments-Releases`
 *   - `core-only`: Fair Payments Connector without the Experimental plugin.
 *   - `both-updated`: both plugins as installed.
 *   - `core-old-experimental`: the updated Fair Payments Connector next to an
 *     Experimental release from before the API token handoff. That release
 *     defined its version constant but not the handoff constant, and served
 *     the token routes from its own controllers unconditionally. The fixture
 *     stands in for it with the Experimental plugin's controllers.
 *   - `old-core-experimental`: the updated Experimental plugin next to a Fair
 *     Payments Connector release from before API tokens moved there. That
 *     release shipped the Schema and Transaction classes the Experimental
 *     plugin reads, but neither the ownership constant nor the token routes.
 *     The fixture loads only Fair Payments Connector's autoloader.
 * - `X-Fair-E2E-Plugin-Order: experimental-first` loads the Experimental
 *   plugin (or its stand-in) before Fair Payments Connector (or its stand-in).
 *   Without it Fair Payments Connector loads first, as WordPress sorts them.
 * - `X-Fair-E2E-Old-Shared-First: 1` registers, ahead of every plugin, a
 *   real copy of the shared package from before 0.2.17 (0.2.10, as Fair
 *   Timetable 0.8.0 ships it) with the shared-library loader, and loads that
 *   release's Composer autoloader, as an older Fair plugin whose directory
 *   sorts first would. That copy lacks the classes 0.2.17 added; the loader
 *   must still select the newest copy and serve every shared class from it.
 *
 * GET /fair-e2e/v1/api-token-releases reports what the request ran with.
 *
 * @package FairE2E
 */

defined( 'ABSPATH' ) || die;

const FAIR_E2E_RELEASES_CORE         = 'fair-payments-connector/fair-payments-connector.php';
const FAIR_E2E_RELEASES_EXPERIMENTAL = 'fair-payments-connector-experimental/fair-payments-connector-experimental.php';

// phpcs:disable WordPress.Security.ValidatedSanitizedInput -- compared against fixed values only.
$GLOBALS['fair_e2e_releases'] = array(
	'releases'   => isset( $_SERVER['HTTP_X_FAIR_E2E_PAYMENTS_RELEASES'] ) ? (string) $_SERVER['HTTP_X_FAIR_E2E_PAYMENTS_RELEASES'] : '',
	'order'      => isset( $_SERVER['HTTP_X_FAIR_E2E_PLUGIN_ORDER'] ) && 'experimental-first' === $_SERVER['HTTP_X_FAIR_E2E_PLUGIN_ORDER'] ? 'experimental-first' : 'core-first',
	'old_shared' => ! empty( $_SERVER['HTTP_X_FAIR_E2E_OLD_SHARED_FIRST'] ),
	'loaded'     => array(),
);
// phpcs:enable

/**
 * Shared classes added in 0.2.17, absent from older copies.
 *
 * @return string[]
 */
function fair_e2e_releases_new_shared_classes() {
	return array(
		'FairEventsShared\\ApiTokens\\AbstractApiToken',
		'FairEventsShared\\ApiTokens\\AbstractApiTokenAuth',
		'FairEventsShared\\API\\AbstractApiTokensController',
		'FairEventsShared\\API\\AbstractExternalMeController',
		'FairEventsShared\\API\\AbstractExternalTransactionsController',
	);
}

/**
 * Record a (real or stand-in) plugin as loaded, in order.
 *
 * @param string $name Plugin label.
 * @return void
 */
function fair_e2e_releases_mark_loaded( $name ) {
	$GLOBALS['fair_e2e_releases']['loaded'][] = $name;
}

/**
 * Run a stand-in plugin's load step at the position its order calls for.
 *
 * Loading "first" happens now, before any regular plugin file. Loading
 * "second" happens once every regular plugin file has loaded, and before
 * anything reads the ownership constants on `plugins_loaded`.
 *
 * @param bool     $first Whether the stand-in loads before the real plugin.
 * @param callable $load  Load step.
 * @return void
 */
function fair_e2e_releases_load_stand_in( $first, callable $load ) {
	if ( $first ) {
		$load();
		return;
	}
	add_action( 'plugins_loaded', $load, PHP_INT_MIN );
}

$fair_e2e_releases_scenario = $GLOBALS['fair_e2e_releases']['releases'];
if ( in_array( $fair_e2e_releases_scenario, array( 'core-only', 'both-updated', 'core-old-experimental', 'old-core-experimental' ), true ) ) {
	$fair_e2e_releases_experimental_first = 'experimental-first' === $GLOBALS['fair_e2e_releases']['order'];

	add_action(
		'plugin_loaded',
		static function ( $file ) {
			$plugin = plugin_basename( $file );
			if ( FAIR_E2E_RELEASES_CORE === $plugin ) {
				fair_e2e_releases_mark_loaded( 'core' );
			} elseif ( FAIR_E2E_RELEASES_EXPERIMENTAL === $plugin ) {
				fair_e2e_releases_mark_loaded( 'experimental' );
			}
		}
	);

	add_filter(
		'option_active_plugins',
		static function ( $plugins ) use ( $fair_e2e_releases_scenario, $fair_e2e_releases_experimental_first ) {
			$plugins = array_values(
				array_diff( (array) $plugins, array( FAIR_E2E_RELEASES_CORE, FAIR_E2E_RELEASES_EXPERIMENTAL ) )
			);

			$pair = array();
			if ( 'old-core-experimental' !== $fair_e2e_releases_scenario ) {
				$pair[] = FAIR_E2E_RELEASES_CORE;
			}
			if ( in_array( $fair_e2e_releases_scenario, array( 'both-updated', 'old-core-experimental' ), true ) ) {
				$pair[] = FAIR_E2E_RELEASES_EXPERIMENTAL;
			}
			if ( $fair_e2e_releases_experimental_first ) {
				$pair = array_reverse( $pair );
			}

			return array_merge( $pair, $plugins );
		}
	);

	if ( 'core-old-experimental' === $fair_e2e_releases_scenario ) {
		fair_e2e_releases_load_stand_in(
			$fair_e2e_releases_experimental_first,
			static function () {
				// A pre-handoff release: the version constant, no handoff constant.
				define( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION', '0.5.0' );
				require_once WP_PLUGIN_DIR . '/fair-payments-connector-experimental/vendor/autoload.php';
				fair_e2e_releases_mark_loaded( 'experimental (pre-handoff)' );

				add_action(
					'rest_api_init',
					static function () {
						( new \FairPaymentsConnectorExperimental\API\ApiTokensController() )->register_routes();
						( new \FairPaymentsConnectorExperimental\API\ExternalMeController() )->register_routes();
						( new \FairPaymentsConnectorExperimental\API\ExternalTransactionsController() )->register_routes();
					}
				);
			}
		);
	}

	if ( 'old-core-experimental' === $fair_e2e_releases_scenario ) {
		fair_e2e_releases_load_stand_in(
			! $fair_e2e_releases_experimental_first,
			static function () {
				// A pre-token release: its classes, no ownership constant, no token routes.
				require_once WP_PLUGIN_DIR . '/fair-payments-connector/vendor/autoload.php';
				fair_e2e_releases_mark_loaded( 'core (pre-token)' );
			}
		);
	}
}

/**
 * Plugin directory of the release bundling the older shared copy: Fair
 * Timetable 0.8.0 as shipped, with shared 0.2.10 (see lib/legacy-shared/).
 *
 * @return string
 */
function fair_e2e_releases_old_shared_plugin_dir() {
	return __DIR__ . '/lib/legacy-shared/fair-timetable-0.8.0';
}

/**
 * Package directory of the older shared copy, as the loader reports it.
 *
 * @return string
 */
function fair_e2e_releases_old_shared_dir() {
	$dir  = fair_e2e_releases_old_shared_plugin_dir() . '/vendor/fair-events/shared';
	$real = realpath( $dir );
	return rtrim( str_replace( '\\', '/', false === $real ? $dir : $real ), '/' );
}

/**
 * A plugin path relative to the plugins directory.
 *
 * @param string $path Absolute path.
 * @return string
 */
function fair_e2e_releases_plugin_relative( $path ) {
	return str_replace( trailingslashit( WP_PLUGIN_DIR ), '', $path );
}

if ( $GLOBALS['fair_e2e_releases']['old_shared'] ) {
	// An older Fair plugin whose directory sorts first: its Composer
	// autoloader is in place and its copy registers with the loader before
	// any other plugin loads. The loader must still select the newest copy.
	require_once fair_e2e_releases_old_shared_plugin_dir() . '/vendor/autoload.php';
	require_once WP_PLUGIN_DIR . '/fair-payments-connector/vendor/fair-events/shared/bootstrap.php';
	Fair_Events_Shared_Loader::register(
		array(
			'plugin_file' => fair_e2e_releases_old_shared_plugin_dir() . '/fair-timetable.php',
			'package_dir' => fair_e2e_releases_old_shared_dir(),
		)
	);
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'fair-e2e/v1',
			'/api-token-releases',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => static function () {
					$sources = array();
					foreach ( fair_e2e_releases_new_shared_classes() as $class_name ) {
						$sources[ $class_name ] = class_exists( $class_name, false )
							? fair_e2e_releases_plugin_relative( ( new ReflectionClass( $class_name ) )->getFileName() )
							: null;
					}

					$loader = class_exists( 'Fair_Events_Shared_Loader', false ) ? Fair_Events_Shared_Loader::report() : null;

					return rest_ensure_response(
						array(
							'releases'       => $GLOBALS['fair_e2e_releases']['releases'],
							'order'          => $GLOBALS['fair_e2e_releases']['order'],
							'loaded'         => $GLOBALS['fair_e2e_releases']['loaded'],
							'old_shared'     => $GLOBALS['fair_e2e_releases']['old_shared'],
							'old_shared_dir' => fair_e2e_releases_old_shared_dir(),
							'shared_loader'  => null === $loader ? null : array(
								'state'      => $loader['state'],
								'registered' => array_map(
									static function ( $package ) {
										return array(
											'dir'     => $package['dir'],
											'version' => $package['version'],
										);
									},
									$loader['packages']
								),
								'selected'   => null === $loader['selected'] ? null : array(
									'dir'     => $loader['selected']['dir'],
									'plugin'  => fair_e2e_releases_plugin_relative( $loader['selected']['dir'] ),
									'version' => $loader['selected']['version'],
								),
							),
							'shared_source'  => $sources,
							'constants'      => array(
								'owns'                 => defined( 'FAIR_PAYMENTS_CONNECTOR_OWNS_API_TOKENS' ),
								'handoff'              => defined( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_API_TOKENS_HANDOFF' ),
								'experimental_version' => defined( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION' ) ? FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION : null,
							),
						)
					);
				},
			)
		);
	}
);
