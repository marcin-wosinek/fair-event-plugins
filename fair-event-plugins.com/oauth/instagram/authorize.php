<?php
/**
 * Instagram OAuth Authorization Endpoint
 *
 * Initiates the Instagram OAuth flow by redirecting to Facebook's authorization page.
 * Uses Instagram Graph API via Facebook Login.
 *
 * Expected query parameters:
 * - site_id: Base64 encoded site hostname
 * - return_url: URL to redirect back to after authorization
 * - site_name: Name of the WordPress site
 * - site_url: Base URL of the WordPress site
 */

require_once dirname( __DIR__, 2 ) . '/vendor/autoload.php';
require_once dirname( __DIR__, 2 ) . '/secrets.php';

// Validate required parameters.
$site_id    = $_GET['site_id'] ?? '';
$return_url = $_GET['return_url'] ?? '';
$site_name  = $_GET['site_name'] ?? '';
$site_url   = $_GET['site_url'] ?? '';

if ( empty( $site_id ) || empty( $return_url ) ) {
	http_response_code( 400 );
	die( 'Missing required parameters: site_id and return_url are required.' );
}

// Validate return_url is a valid URL.
if ( ! filter_var( $return_url, FILTER_VALIDATE_URL ) ) {
	http_response_code( 400 );
	die( 'Invalid return_url parameter.' );
}

// Store state in session for CSRF protection.
session_start();
$state = bin2hex( random_bytes( 16 ) );
$_SESSION['instagram_oauth_state']      = $state;
$_SESSION['instagram_oauth_return_url'] = $return_url;
$_SESSION['instagram_oauth_site_id']    = $site_id;
$_SESSION['instagram_oauth_site_name']  = $site_name;
$_SESSION['instagram_oauth_site_url']   = $site_url;

// Build the callback URL for this server.
$protocol     = ( ! empty( $_SERVER['HTTPS'] ) && $_SERVER['HTTPS'] !== 'off' ) ? 'https' : 'http';
$callback_url = $protocol . '://' . $_SERVER['HTTP_HOST'] . '/oauth/instagram/callback.php';

// Instagram Graph API scopes via Facebook Login.
// instagram_basic - Read basic profile info
// instagram_content_publish - Publish content (optional, for future use)
// instagram_manage_insights - Read insights (optional)
// pages_show_list - Required to get Instagram accounts linked to Pages
// pages_read_engagement - Required for Instagram account access
$scopes = array(
	'instagram_basic',
	'pages_show_list',
	'pages_read_engagement',
);

// Build Facebook OAuth authorization URL.
// Using Facebook's OAuth endpoint because Instagram Graph API requires Facebook Login.
$auth_params = array(
	'client_id'     => $instagramAppId,
	'redirect_uri'  => $callback_url,
	'scope'         => implode( ',', $scopes ),
	'response_type' => 'code',
	'state'         => $state,
);

$auth_url = 'https://www.facebook.com/v24.0/dialog/oauth?' . http_build_query( $auth_params );

// Redirect to Facebook authorization page.
header( 'Location: ' . $auth_url );
exit;
