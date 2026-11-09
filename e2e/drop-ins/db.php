<?php
/**
 * Test-only `db.php` drop-in: fresh-install sites inside the wp-env instance.
 *
 * Mounted at `wp-content/db.php` by `.wp-env.json`, so it loads only inside
 * the Playwright wp-env instance, never in production or the dev `docker
 * compose` stack. WordPress loads `db.php` before it sets the table prefix,
 * which lets a request choose a separate, independently installed WordPress
 * in the same database: the `X-Fair-E2E-Site` request header (HTTP) or the
 * `FAIR_E2E_SITE` environment variable (WP-CLI) names one of the sites
 * below. Each has its own users, options, active plugins and plugin tables,
 * so a plugin that was never activated there has no tables and no history,
 * as on a real fresh installation (#2112).
 *
 * Without the header or variable, nothing changes: the default site keeps
 * the prefix from `wp-config.php`. See e2e/README.md § Fresh-install sites.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * Table prefixes of the fresh-install sites, by name.
 *
 * Only names listed here switch the prefix, so a request can never point
 * WordPress at an arbitrary prefix, and none of these can match the default
 * `wp_` site's tables.
 */
const FAIR_E2E_FRESH_SITES = array(
	'events-only'      => 'e2efresh_events_',
	'events-connector' => 'e2efresh_connector_',
);

( static function () {
	$site = '';
	if ( isset( $_SERVER['HTTP_X_FAIR_E2E_SITE'] ) && is_string( $_SERVER['HTTP_X_FAIR_E2E_SITE'] ) ) {
		$site = $_SERVER['HTTP_X_FAIR_E2E_SITE']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- compared against a fixed allowlist below.
	} elseif ( 'cli' === PHP_SAPI && is_string( getenv( 'FAIR_E2E_SITE' ) ) ) {
		$site = getenv( 'FAIR_E2E_SITE' );
	}
	if ( isset( FAIR_E2E_FRESH_SITES[ $site ] ) ) {
		$GLOBALS['table_prefix'] = FAIR_E2E_FRESH_SITES[ $site ]; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- the drop-in's purpose.
	}
} )();
