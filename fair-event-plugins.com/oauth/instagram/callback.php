<?php
/**
 * Instagram OAuth Callback Endpoint
 *
 * Handles the callback from Facebook's OAuth flow, exchanges the code for tokens,
 * and redirects back to the WordPress site with the tokens.
 */

require_once dirname( __DIR__, 2 ) . '/vendor/autoload.php';
require_once dirname( __DIR__, 2 ) . '/secrets.php';

session_start();

// Check for errors from Facebook.
if ( isset( $_GET['error'] ) ) {
	$error = $_GET['error'];
	$return_url = $_SESSION['instagram_oauth_return_url'] ?? '';

	if ( ! empty( $return_url ) ) {
		$redirect_url = $return_url . ( strpos( $return_url, '?' ) !== false ? '&' : '?' ) . 'error=' . urlencode( $error );
		header( 'Location: ' . $redirect_url );
	} else {
		http_response_code( 400 );
		echo 'OAuth error: ' . htmlspecialchars( $error );
	}
	exit;
}

// Validate state to prevent CSRF.
$state = $_GET['state'] ?? '';
$stored_state = $_SESSION['instagram_oauth_state'] ?? '';

if ( empty( $state ) || $state !== $stored_state ) {
	http_response_code( 400 );
	die( 'Invalid state parameter. Possible CSRF attack.' );
}

// Get the authorization code.
$code = $_GET['code'] ?? '';
if ( empty( $code ) ) {
	http_response_code( 400 );
	die( 'Missing authorization code.' );
}

// Retrieve stored session data.
$return_url = $_SESSION['instagram_oauth_return_url'] ?? '';
$site_id    = $_SESSION['instagram_oauth_site_id'] ?? '';
$site_name  = $_SESSION['instagram_oauth_site_name'] ?? '';
$site_url   = $_SESSION['instagram_oauth_site_url'] ?? '';

if ( empty( $return_url ) ) {
	http_response_code( 400 );
	die( 'Missing return URL from session.' );
}

// Build the callback URL (must match the one used in authorize.php).
$protocol     = ( ! empty( $_SERVER['HTTPS'] ) && $_SERVER['HTTPS'] !== 'off' ) ? 'https' : 'http';
$callback_url = $protocol . '://' . $_SERVER['HTTP_HOST'] . '/oauth/instagram/callback.php';

// Exchange code for access token.
$token_url = 'https://graph.facebook.com/v21.0/oauth/access_token';
$token_params = array(
	'client_id'     => $instagramAppId,
	'client_secret' => $instagramAppSecret,
	'redirect_uri'  => $callback_url,
	'code'          => $code,
);

$ch = curl_init();
curl_setopt( $ch, CURLOPT_URL, $token_url . '?' . http_build_query( $token_params ) );
curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
curl_setopt( $ch, CURLOPT_TIMEOUT, 30 );
$token_response = curl_exec( $ch );
$curl_error = curl_error( $ch );
curl_close( $ch );

if ( $curl_error ) {
	error_log( 'Instagram OAuth curl error: ' . $curl_error );
	redirect_with_error( $return_url, 'connection_error' );
}

$token_data = json_decode( $token_response, true );

if ( isset( $token_data['error'] ) ) {
	error_log( 'Instagram OAuth token error: ' . json_encode( $token_data['error'] ) );
	redirect_with_error( $return_url, 'token_error' );
}

$access_token = $token_data['access_token'] ?? '';
$expires_in   = $token_data['expires_in'] ?? 5184000; // Default 60 days for long-lived tokens.

if ( empty( $access_token ) ) {
	error_log( 'Instagram OAuth: No access token received' );
	redirect_with_error( $return_url, 'no_token' );
}

// Exchange short-lived token for long-lived token.
$long_lived_url = 'https://graph.facebook.com/v21.0/oauth/access_token?' . http_build_query( array(
	'grant_type'        => 'fb_exchange_token',
	'client_id'         => $instagramAppId,
	'client_secret'     => $instagramAppSecret,
	'fb_exchange_token' => $access_token,
) );

$ch = curl_init();
curl_setopt( $ch, CURLOPT_URL, $long_lived_url );
curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
curl_setopt( $ch, CURLOPT_TIMEOUT, 30 );
$long_lived_response = curl_exec( $ch );
curl_close( $ch );

$long_lived_data = json_decode( $long_lived_response, true );

if ( isset( $long_lived_data['access_token'] ) ) {
	$access_token = $long_lived_data['access_token'];
	$expires_in   = $long_lived_data['expires_in'] ?? 5184000;
}

// Get the user's Facebook Pages to find linked Instagram accounts.
$pages_url = 'https://graph.facebook.com/v21.0/me/accounts?' . http_build_query( array(
	'access_token' => $access_token,
	'fields'       => 'id,name,instagram_business_account',
) );

$ch = curl_init();
curl_setopt( $ch, CURLOPT_URL, $pages_url );
curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
curl_setopt( $ch, CURLOPT_TIMEOUT, 30 );
$pages_response = curl_exec( $ch );
curl_close( $ch );

$pages_data = json_decode( $pages_response, true );

$instagram_user_id = '';
$instagram_username = '';

// Find the first Instagram Business Account linked to a Page.
if ( isset( $pages_data['data'] ) && is_array( $pages_data['data'] ) ) {
	foreach ( $pages_data['data'] as $page ) {
		if ( isset( $page['instagram_business_account']['id'] ) ) {
			$instagram_user_id = $page['instagram_business_account']['id'];

			// Get Instagram account details.
			$ig_url = 'https://graph.facebook.com/v21.0/' . $instagram_user_id . '?' . http_build_query( array(
				'access_token' => $access_token,
				'fields'       => 'id,username',
			) );

			$ch = curl_init();
			curl_setopt( $ch, CURLOPT_URL, $ig_url );
			curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
			curl_setopt( $ch, CURLOPT_TIMEOUT, 30 );
			$ig_response = curl_exec( $ch );
			curl_close( $ch );

			$ig_data = json_decode( $ig_response, true );
			$instagram_username = $ig_data['username'] ?? '';

			break; // Use the first Instagram account found.
		}
	}
}

// If no Instagram Business Account found, try to get basic user info.
if ( empty( $instagram_user_id ) ) {
	// Get basic Facebook user info as fallback.
	$me_url = 'https://graph.facebook.com/v21.0/me?' . http_build_query( array(
		'access_token' => $access_token,
		'fields'       => 'id,name',
	) );

	$ch = curl_init();
	curl_setopt( $ch, CURLOPT_URL, $me_url );
	curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
	curl_setopt( $ch, CURLOPT_TIMEOUT, 30 );
	$me_response = curl_exec( $ch );
	curl_close( $ch );

	$me_data = json_decode( $me_response, true );

	// Note: Without an Instagram Business Account linked to a Page,
	// we can't access Instagram APIs. The user needs to set this up.
	error_log( 'Instagram OAuth: No Instagram Business Account found for user ' . ( $me_data['id'] ?? 'unknown' ) );
	redirect_with_error( $return_url, 'no_instagram_account' );
}

// Clear session data.
unset( $_SESSION['instagram_oauth_state'] );
unset( $_SESSION['instagram_oauth_return_url'] );
unset( $_SESSION['instagram_oauth_site_id'] );
unset( $_SESSION['instagram_oauth_site_name'] );
unset( $_SESSION['instagram_oauth_site_url'] );

// Build redirect URL with tokens.
$redirect_params = array(
	'instagram_access_token' => $access_token,
	'instagram_user_id'      => $instagram_user_id,
	'instagram_username'     => $instagram_username,
	'instagram_expires_in'   => $expires_in,
);

$redirect_url = $return_url . ( strpos( $return_url, '?' ) !== false ? '&' : '?' ) . http_build_query( $redirect_params );

header( 'Location: ' . $redirect_url );
exit;

/**
 * Redirect back to the WordPress site with an error.
 *
 * @param string $return_url The return URL.
 * @param string $error      The error code.
 */
function redirect_with_error( $return_url, $error ) {
	if ( ! empty( $return_url ) ) {
		$redirect_url = $return_url . ( strpos( $return_url, '?' ) !== false ? '&' : '?' ) . 'error=' . urlencode( $error );
		header( 'Location: ' . $redirect_url );
	} else {
		http_response_code( 400 );
		echo 'OAuth error: ' . htmlspecialchars( $error );
	}
	exit;
}
