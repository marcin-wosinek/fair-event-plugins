<?php
/**
 * Plugin Name: Fair E2E shared-library legacy releases
 * Description: Test-only. Lets SharedLibraryLoader.api.spec.js and the
 *              shared-library notice E2E spec run one request next to a
 *              real, shipped Fair Timetable release that predates the
 *              shared-library loader (#2181).
 *
 * The lib/legacy-shared/fair-timetable-<version>/ directory holds the main file and the
 * vendor/ tree of each audited release exactly as wordpress.org ships it
 * (see lib/legacy-shared/README.md). Only the Composer autoloader runs; the
 * release's own plugin code stays out, so the real Fair Timetable plugin
 * directory is untouched.
 *
 * A request opts in with headers; requests without them are untouched:
 *
 * - `X-Fair-E2E-Legacy-Shared: 0.7.0|0.7.1|0.8.0` loads that release's
 *   Composer autoloader.
 * - `X-Fair-E2E-Legacy-Order: first` loads it before every plugin, as a
 *   release whose directory sorts first would. Otherwise it loads after
 *   every plugin and before shared-library selection, where Fair Timetable
 *   really loads.
 * - `X-Fair-E2E-Legacy-Early: 1` then loads FairEventsShared\Admin\SettingsPage
 *   through it straight away, as those releases do while their main file
 *   loads on admin requests.
 *
 * GET /fair-e2e/v1/shared-loader reports the selection, where shared classes
 * actually loaded from, whether updated plugins started, and every PHP
 * diagnostic the request raised.
 *
 * @package FairE2E
 */

defined( 'ABSPATH' ) || die;

const FAIR_E2E_LEGACY_SHARED_RELEASES = array( '0.7.0', '0.7.1', '0.8.0' );

// phpcs:disable WordPress.Security.ValidatedSanitizedInput -- compared against fixed values only.
$GLOBALS['fair_e2e_legacy_shared'] = array(
	'release'     => isset( $_SERVER['HTTP_X_FAIR_E2E_LEGACY_SHARED'] ) && in_array( $_SERVER['HTTP_X_FAIR_E2E_LEGACY_SHARED'], FAIR_E2E_LEGACY_SHARED_RELEASES, true ) ? (string) $_SERVER['HTTP_X_FAIR_E2E_LEGACY_SHARED'] : '',
	'order'       => isset( $_SERVER['HTTP_X_FAIR_E2E_LEGACY_ORDER'] ) && 'first' === $_SERVER['HTTP_X_FAIR_E2E_LEGACY_ORDER'] ? 'first' : 'last',
	'early'       => ! empty( $_SERVER['HTTP_X_FAIR_E2E_LEGACY_EARLY'] ),
	'diagnostics' => array(),
);
// phpcs:enable

/**
 * Directory of a legacy release fixture.
 *
 * @param string $release Release version.
 * @return string
 */
function fair_e2e_legacy_shared_dir( $release ) {
	return __DIR__ . '/lib/legacy-shared/fair-timetable-' . $release;
}

/**
 * Load the requested release's Composer autoloader, and with Early, the
 * class its main file loads on admin requests.
 *
 * @return void
 */
function fair_e2e_legacy_shared_load() {
	$release = $GLOBALS['fair_e2e_legacy_shared']['release'];
	require_once fair_e2e_legacy_shared_dir( $release ) . '/vendor/autoload.php';
	if ( $GLOBALS['fair_e2e_legacy_shared']['early'] ) {
		class_exists( 'FairEventsShared\\Admin\\SettingsPage' );
	}
}

if ( '' !== $GLOBALS['fair_e2e_legacy_shared']['release'] ) {
	// Record every diagnostic this request raises, then let PHP and any
	// earlier handler deal with it as usual.
	set_error_handler( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_set_error_handler -- test-only diagnostics capture.
		static function ( $errno, $errstr, $errfile, $errline ) {
			$GLOBALS['fair_e2e_legacy_shared']['diagnostics'][] = array(
				'level'   => $errno,
				'message' => $errstr,
				'file'    => $errfile,
				'line'    => $errline,
			);
			return false;
		}
	);

	if ( 'first' === $GLOBALS['fair_e2e_legacy_shared']['order'] ) {
		fair_e2e_legacy_shared_load();
	} else {
		// Added before any plugin loads, so it runs ahead of the loader's
		// own selection at the same priority.
		add_action( 'plugins_loaded', 'fair_e2e_legacy_shared_load', PHP_INT_MIN );
	}
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'fair-e2e/v1',
			'/shared-loader',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => 'fair_e2e_shared_loader_report',
			)
		);
	}
);

/**
 * Report what this request selected and loaded.
 *
 * @return WP_REST_Response
 */
function fair_e2e_shared_loader_report() {
	$report = class_exists( 'Fair_Events_Shared_Loader', false ) ? Fair_Events_Shared_Loader::report() : null;

	// Load a class every copy has, the class the legacy releases load on
	// admin requests, and one the legacy copies lack, then say where each
	// came from. After a conflict nothing is loaded on purpose.
	$classes = array(
		'FairEventsShared\\Money',
		'FairEventsShared\\Admin\\SettingsPage',
		'FairEventsShared\\ApiTokens\\AbstractApiToken',
	);
	$loaded  = array();
	foreach ( $classes as $class_name ) {
		if ( null !== $report && 'conflict' === $report['state'] && ! class_exists( $class_name, false ) ) {
			$loaded[ $class_name ] = null;
			continue;
		}
		$loaded[ $class_name ] = class_exists( $class_name ) ? ( new ReflectionClass( $class_name ) )->getFileName() : null;
	}

	$routes = array_keys( rest_get_server()->get_routes() );

	return new WP_REST_Response(
		array(
			'fixture'     => array(
				'release' => $GLOBALS['fair_e2e_legacy_shared']['release'],
				'order'   => $GLOBALS['fair_e2e_legacy_shared']['order'],
				'early'   => $GLOBALS['fair_e2e_legacy_shared']['early'],
				'dir'     => '' === $GLOBALS['fair_e2e_legacy_shared']['release'] ? null : str_replace( '\\', '/', realpath( fair_e2e_legacy_shared_dir( $GLOBALS['fair_e2e_legacy_shared']['release'] ) ) ),
			),
			'loader'      => $report,
			'bundles'     => class_exists( 'Fair_Events_Shared_Loader', false ) ? Fair_Events_Shared_Loader::bundles() : array(),
			'outdated'    => class_exists( 'Fair_Events_Shared_Loader', false ) ? array_values( Fair_Events_Shared_Loader::outdated_plugins() ) : array(),
			'loaded'      => $loaded,
			'started'     => array(
				'fair-events'             => in_array( '/fair-events/v1', $routes, true ),
				'fair-audience'           => in_array( '/fair-audience/v1', $routes, true ),
				'fair-payments-connector' => in_array( '/fair-payments-connector/v1', $routes, true ),
			),
			'diagnostics' => $GLOBALS['fair_e2e_legacy_shared']['diagnostics'],
		)
	);
}
