<?php
/**
 * Router for local development with PHP's built-in server.
 *
 * Run: php -S localhost:4242 router.php
 *
 * Mirrors the production fallback documented in README.md: Stripe's
 * /return/{account} and /refresh/{account} callbacks serve index.html.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

if ( 'cli-server' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit;
}

$fep_path = (string) parse_url( $_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url, WordPress.Security.ValidatedSanitizedInput -- Local development server only.

if ( preg_match( '#^/(return|refresh)/acct_[A-Za-z0-9]+/?$#', $fep_path ) ) {
	header( 'Content-Type: text/html; charset=utf-8' );
	readfile( __DIR__ . '/index.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- Local development server only.
	return true;
}

// Never serve configuration, dependencies or tooling.
if ( preg_match( '#^/(\.env|vendor|src|bin|__tests__|composer\.|phpunit\.xml|router\.php|secrets\.php)#', $fep_path ) ) {
	http_response_code( 404 );
	return true;
}

return false;
