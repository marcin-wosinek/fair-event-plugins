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
 * - `X-Fair-E2E-Old-Shared-First: 1` registers, ahead of every plugin, an
 *   autoloader for a copy of the shared package from before 0.2.17: it
 *   serves every FairEventsShared class except the ones 0.2.17 added, as an
 *   older bundled copy winning the autoload race would.
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
	'declined'   => array(),
	'served'     => array(),
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
 * Autoloader for a pre-0.2.17 copy of the shared package.
 *
 * @param string $class_name Class to load.
 * @return void
 */
function fair_e2e_releases_old_shared_autoload( $class_name ) {
	if ( 0 !== strpos( $class_name, 'FairEventsShared\\' ) ) {
		return;
	}
	if ( in_array( $class_name, fair_e2e_releases_new_shared_classes(), true ) ) {
		$GLOBALS['fair_e2e_releases']['declined'][] = $class_name;
		return;
	}

	$relative = str_replace( '\\', '/', substr( $class_name, strlen( 'FairEventsShared\\' ) ) ) . '.php';
	foreach ( array( 'fair-events', 'fair-payments-connector', 'fair-payments-connector-experimental' ) as $plugin ) {
		$file = WP_PLUGIN_DIR . '/' . $plugin . '/vendor/fair-events/shared/src/' . $relative;
		if ( file_exists( $file ) ) {
			$GLOBALS['fair_e2e_releases']['served'][] = $class_name;
			require $file;
			return;
		}
	}
}

if ( $GLOBALS['fair_e2e_releases']['old_shared'] ) {
	// Composer prepends each plugin's autoloader as its main file loads, so
	// prepend this one again once they all have, ahead of the token routes.
	spl_autoload_register( 'fair_e2e_releases_old_shared_autoload', true, true );
	add_action(
		'plugins_loaded',
		static function () {
			spl_autoload_unregister( 'fair_e2e_releases_old_shared_autoload' );
			spl_autoload_register( 'fair_e2e_releases_old_shared_autoload', true, true );
		},
		PHP_INT_MIN
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
							? str_replace( trailingslashit( WP_PLUGIN_DIR ), '', ( new ReflectionClass( $class_name ) )->getFileName() )
							: null;
					}

					return rest_ensure_response(
						array(
							'releases'      => $GLOBALS['fair_e2e_releases']['releases'],
							'order'         => $GLOBALS['fair_e2e_releases']['order'],
							'loaded'        => $GLOBALS['fair_e2e_releases']['loaded'],
							'old_shared'    => $GLOBALS['fair_e2e_releases']['old_shared'],
							'declined'      => array_values( array_unique( $GLOBALS['fair_e2e_releases']['declined'] ) ),
							'served'        => array_values( array_unique( $GLOBALS['fair_e2e_releases']['served'] ) ),
							'shared_source' => $sources,
							'constants'     => array(
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
