<?php
/**
 * Plugin Name: Fair Events E2E Basic Auth
 * Description: Basic Authentication handler for the REST API, test-only.
 *              Loaded ONLY inside the Playwright wp-env instance (mounted via
 *              the `mappings` entry in .wp-env.json) so `.api.spec.js` specs
 *              can authenticate their requests with the admin login password
 *              over Basic Auth. Never shipped to production and never
 *              mounted by the dev `docker compose` stack. Vendored from
 *              https://github.com/WP-API/Basic-Auth (WordPress API Team).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * Authenticate the current request from Basic Auth credentials, test-only.
 *
 * @param int|false|null $user Current user id/false/null from an earlier filter.
 * @return int|null Authenticated user id, or the passed-through $user.
 */
function fair_e2e_basic_auth_handler( $user ) {
	global $fair_e2e_basic_auth_error;

	$fair_e2e_basic_auth_error = null;

	// Don't authenticate twice.
	if ( ! empty( $user ) ) {
		return $user;
	}

	// Check that we're trying to authenticate.
	if ( ! isset( $_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW'] ) ) {
		return $user;
	}

	$username = sanitize_text_field( wp_unslash( $_SERVER['PHP_AUTH_USER'] ) );
	$password = sanitize_text_field( wp_unslash( $_SERVER['PHP_AUTH_PW'] ) );

	/*
	 * wp_authenticate() re-enters determine_current_user via
	 * wp_authenticate_spam_check on multisite; remove this filter for the
	 * duration of the call to avoid infinite recursion.
	 */
	remove_filter( 'determine_current_user', 'fair_e2e_basic_auth_handler', 20 );

	$user = wp_authenticate( $username, $password );

	add_filter( 'determine_current_user', 'fair_e2e_basic_auth_handler', 20 );

	if ( is_wp_error( $user ) ) {
		$fair_e2e_basic_auth_error = $user;
		return null;
	}

	$fair_e2e_basic_auth_error = true;

	return $user->ID;
}
add_filter( 'determine_current_user', 'fair_e2e_basic_auth_handler', 20 );

/**
 * Surface a Basic Auth failure through the REST authentication errors filter.
 *
 * @param WP_Error|null|true $error Passed-through error from an earlier filter.
 * @return WP_Error|null|true
 */
function fair_e2e_basic_auth_error( $error ) {
	// Passthrough other errors.
	if ( ! empty( $error ) ) {
		return $error;
	}

	global $fair_e2e_basic_auth_error;

	return $fair_e2e_basic_auth_error;
}
add_filter( 'rest_authentication_errors', 'fair_e2e_basic_auth_error' );
