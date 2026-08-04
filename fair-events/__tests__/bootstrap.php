<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairEvents
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

if ( ! defined( 'MINUTE_IN_SECONDS' ) ) {
	define( 'MINUTE_IN_SECONDS', 60 );
}

if ( ! defined( 'HOUR_IN_SECONDS' ) ) {
	define( 'HOUR_IN_SECONDS', 60 * MINUTE_IN_SECONDS );
}

if ( ! defined( 'DAY_IN_SECONDS' ) ) {
	define( 'DAY_IN_SECONDS', 24 * HOUR_IN_SECONDS );
}

if ( ! defined( 'YEAR_IN_SECONDS' ) ) {
	define( 'YEAR_IN_SECONDS', 365 * DAY_IN_SECONDS );
}

if ( ! defined( 'MB_IN_BYTES' ) ) {
	define( 'MB_IN_BYTES', 1048576 );
}

// Minimal WordPress function stubs so pure settings logic can be unit tested
// without a full WP bootstrap. Tests seed values via $GLOBALS['_fair_test_options'].
if ( ! function_exists( 'sanitize_key' ) ) {
	/**
	 * Stub of WordPress sanitize_key().
	 *
	 * @param string $key Key to sanitize.
	 * @return string Lowercased key stripped to [a-z0-9_-].
	 */
	function sanitize_key( $key ) {
		$key = strtolower( (string) $key );
		return preg_replace( '/[^a-z0-9_\-]/', '', $key );
	}
}

if ( ! function_exists( 'get_option' ) ) {
	/**
	 * Stub of WordPress get_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value  Value returned when the option is unset.
	 * @return mixed Stored value or the default.
	 */
	function get_option( $name, $default_value = false ) {
		$options = isset( $GLOBALS['_fair_test_options'] ) ? $GLOBALS['_fair_test_options'] : array();
		return array_key_exists( $name, $options ) ? $options[ $name ] : $default_value;
	}
}

if ( ! function_exists( 'update_option' ) ) {
	/**
	 * Stub of WordPress update_option() backed by $GLOBALS['_fair_test_options'].
	 * Also records each call in $GLOBALS['_fair_test_update_option_calls'] so
	 * tests can assert how many times (and with what option names) it ran.
	 *
	 * @param string $name     Option name.
	 * @param mixed  $value    Value to store.
	 * @param mixed  $autoload Ignored — present only to match the real signature.
	 * @return bool Always true.
	 */
	function update_option( $name, $value, $autoload = null ) {
		if ( ! isset( $GLOBALS['_fair_test_options'] ) ) {
			$GLOBALS['_fair_test_options'] = array();
		}
		$GLOBALS['_fair_test_options'][ $name ] = $value;

		if ( ! isset( $GLOBALS['_fair_test_update_option_calls'] ) ) {
			$GLOBALS['_fair_test_update_option_calls'] = array();
		}
		$GLOBALS['_fair_test_update_option_calls'][] = $name;

		return true;
	}
}

if ( ! function_exists( 'get_permalink' ) ) {
	/**
	 * Stub of WordPress get_permalink() — deterministic URL from a post ID.
	 *
	 * @param int $post_id Post ID.
	 * @return string Fake permalink.
	 */
	function get_permalink( $post_id ) {
		return 'https://example.com/?p=' . (int) $post_id;
	}
}

if ( ! function_exists( 'get_the_title' ) ) {
	/**
	 * Stub of WordPress get_the_title() — deterministic title from a post ID.
	 *
	 * @param int $post_id Post ID.
	 * @return string Fake title.
	 */
	function get_the_title( $post_id ) {
		return 'Post ' . (int) $post_id;
	}
}

if ( ! function_exists( 'wp_timezone' ) ) {
	/**
	 * Stub of WordPress wp_timezone() — UTC by default, overridable via
	 * $GLOBALS['_fair_test_timezone'] for timezone-sensitive tests.
	 *
	 * @return \DateTimeZone Site timezone.
	 */
	function wp_timezone() {
		$timezone = isset( $GLOBALS['_fair_test_timezone'] ) ? $GLOBALS['_fair_test_timezone'] : 'UTC';

		return new \DateTimeZone( $timezone );
	}
}

if ( ! function_exists( 'wp_timezone_string' ) ) {
	/**
	 * Stub of WordPress wp_timezone_string() — UTC by default, overridable via
	 * $GLOBALS['_fair_test_timezone'] (same backing global as wp_timezone()).
	 *
	 * @return string Site timezone string, e.g. 'America/New_York'.
	 */
	function wp_timezone_string() {
		return isset( $GLOBALS['_fair_test_timezone'] ) ? $GLOBALS['_fair_test_timezone'] : 'UTC';
	}
}

if ( ! function_exists( 'wp_date' ) ) {
	/**
	 * Stub of WordPress wp_date() — formats a timestamp in the site timezone
	 * (via wp_timezone(), overridable through $GLOBALS['_fair_test_timezone']).
	 * No locale/i18n handling — always formats in the default PHP locale.
	 *
	 * @param string             $format    date() format string.
	 * @param int|null           $timestamp Unix timestamp; defaults to now.
	 * @param \DateTimeZone|null $timezone  Timezone to format in; defaults to the site timezone.
	 * @return string Formatted date.
	 */
	function wp_date( $format, $timestamp = null, $timezone = null ) {
		if ( null === $timestamp ) {
			$timestamp = time();
		}

		if ( ! $timezone instanceof \DateTimeZone ) {
			$timezone = wp_timezone();
		}

		$datetime = new \DateTime( '@' . $timestamp );
		$datetime->setTimezone( $timezone );

		return $datetime->format( $format );
	}
}

if ( ! function_exists( 'absint' ) ) {
	/**
	 * Stub of WordPress absint().
	 *
	 * @param mixed $value Value to cast.
	 * @return int Non-negative integer.
	 */
	function absint( $value ) {
		return abs( (int) $value );
	}
}

if ( ! function_exists( 'wp_unslash' ) ) {
	/**
	 * Stub of WordPress wp_unslash() — a no-op for test input (no magic quotes).
	 *
	 * @param mixed $value Value to unslash.
	 * @return mixed Unmodified value.
	 */
	function wp_unslash( $value ) {
		return $value;
	}
}

if ( ! function_exists( 'sanitize_text_field' ) ) {
	/**
	 * Stub of WordPress sanitize_text_field() — trims whitespace only.
	 *
	 * @param string $value Value to sanitize.
	 * @return string Trimmed value.
	 */
	function sanitize_text_field( $value ) {
		return trim( (string) $value );
	}
}

if ( ! function_exists( 'current_time' ) ) {
	/**
	 * Stub of WordPress current_time() — tests override via $GLOBALS['_fair_test_now'].
	 *
	 * @param string $type Format type, e.g. 'mysql' or a date() format string.
	 * @return string Formatted current (or overridden) time.
	 */
	function current_time( $type ) {
		$now = isset( $GLOBALS['_fair_test_now'] ) ? $GLOBALS['_fair_test_now'] : time();

		if ( 'mysql' === $type ) {
			return gmdate( 'Y-m-d H:i:s', $now );
		}

		return gmdate( $type, $now );
	}
}

if ( ! function_exists( 'esc_url' ) ) {
	/**
	 * Stub of WordPress esc_url() — a no-op pass-through for test input.
	 *
	 * @param string $url URL to sanitize.
	 * @return string Unmodified URL.
	 */
	function esc_url( $url ) {
		return (string) $url;
	}
}

if ( ! function_exists( 'esc_url_raw' ) ) {
	/**
	 * Stub of WordPress esc_url_raw() — a no-op pass-through for test input.
	 *
	 * @param string $url URL to sanitize.
	 * @return string Unmodified URL.
	 */
	function esc_url_raw( $url ) {
		return (string) $url;
	}
}

if ( ! function_exists( 'home_url' ) ) {
	/**
	 * Stub of WordPress home_url() — overridable via $GLOBALS['_fair_test_home_url'].
	 *
	 * @param string $path Path to append.
	 * @return string Fake home URL.
	 */
	function home_url( $path = '' ) {
		$base = isset( $GLOBALS['_fair_test_home_url'] ) ? $GLOBALS['_fair_test_home_url'] : 'https://example.com';
		return $base . $path;
	}
}

if ( ! function_exists( 'get_bloginfo' ) ) {
	/**
	 * Stub of WordPress get_bloginfo() — overridable via $GLOBALS['_fair_test_bloginfo'].
	 *
	 * @param string $show Which value to retrieve.
	 * @return string Fake site info.
	 */
	function get_bloginfo( $show = '' ) {
		$values = isset( $GLOBALS['_fair_test_bloginfo'] ) ? $GLOBALS['_fair_test_bloginfo'] : array();
		return isset( $values[ $show ] ) ? $values[ $show ] : 'Test Site';
	}
}

if ( ! function_exists( 'get_theme_mod' ) ) {
	/**
	 * Stub of WordPress get_theme_mod() backed by $GLOBALS['_fair_test_theme_mods'].
	 *
	 * @param string $name          Theme mod name.
	 * @param mixed  $default_value Value returned when the mod is unset.
	 * @return mixed Stored value or the default.
	 */
	function get_theme_mod( $name, $default_value = false ) {
		$mods = isset( $GLOBALS['_fair_test_theme_mods'] ) ? $GLOBALS['_fair_test_theme_mods'] : array();
		return array_key_exists( $name, $mods ) ? $mods[ $name ] : $default_value;
	}
}

if ( ! function_exists( 'wp_get_attachment_image_url' ) ) {
	/**
	 * Stub of WordPress wp_get_attachment_image_url() backed by
	 * $GLOBALS['_fair_test_attachment_urls'].
	 *
	 * @param int    $attachment_id Attachment ID.
	 * @param string $size          Image size.
	 * @return string|false Stored URL, or false when the attachment is "gone".
	 */
	function wp_get_attachment_image_url( $attachment_id, $size = 'thumbnail' ) {
		$urls = isset( $GLOBALS['_fair_test_attachment_urls'] ) ? $GLOBALS['_fair_test_attachment_urls'] : array();
		return array_key_exists( $attachment_id, $urls ) ? $urls[ $attachment_id ] : false;
	}
}

if ( ! function_exists( 'sanitize_email' ) ) {
	/**
	 * Stub of WordPress sanitize_email() — trims whitespace only.
	 *
	 * @param string $email Email to sanitize.
	 * @return string Trimmed value.
	 */
	function sanitize_email( $email ) {
		return trim( (string) $email );
	}
}

if ( ! function_exists( 'is_email' ) ) {
	/**
	 * Stub of WordPress is_email() — delegates to PHP's filter_var().
	 *
	 * @param string $email Email to validate.
	 * @return string|false The email when valid, false otherwise.
	 */
	function is_email( $email ) {
		return filter_var( $email, FILTER_VALIDATE_EMAIL ) ? $email : false;
	}
}

if ( ! function_exists( 'wp_attachment_is_image' ) ) {
	/**
	 * Stub of WordPress wp_attachment_is_image() backed by
	 * $GLOBALS['_fair_test_image_attachments'] (a list of "valid image" IDs).
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool Whether the attachment ID is a registered test image.
	 */
	function wp_attachment_is_image( $attachment_id ) {
		$ids = isset( $GLOBALS['_fair_test_image_attachments'] ) ? $GLOBALS['_fair_test_image_attachments'] : array();
		return in_array( (int) $attachment_id, $ids, true );
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	/**
	 * Stub of WordPress apply_filters(). Passes through unmodified unless a
	 * test registered a callback for this tag in
	 * $GLOBALS['_fair_test_filters'][ $tag ], in which case that callback runs.
	 *
	 * @param string $tag   Filter name.
	 * @param mixed  $value Value to filter.
	 * @return mixed Filtered (or unmodified) value.
	 */
	function apply_filters( $tag, $value ) {
		if ( isset( $GLOBALS['_fair_test_filters'][ $tag ] ) ) {
			return call_user_func( $GLOBALS['_fair_test_filters'][ $tag ], $value );
		}
		return $value;
	}
}

if ( ! function_exists( 'wp_parse_args' ) ) {
	/**
	 * Stub of WordPress wp_parse_args() — array-only merge (test inputs never
	 * pass an object or query string here).
	 *
	 * @param array $args     Values to parse.
	 * @param array $defaults Defaults to merge under.
	 * @return array Merged arguments.
	 */
	function wp_parse_args( $args, $defaults = array() ) {
		return array_merge( $defaults, (array) $args );
	}
}

if ( ! function_exists( 'add_query_arg' ) ) {
	/**
	 * Minimal stub of WordPress add_query_arg() for a single key/value pair.
	 *
	 * @param string $key   Query arg name.
	 * @param mixed  $value Query arg value.
	 * @param string $url   URL to append to.
	 * @return string Decorated URL.
	 */
	function add_query_arg( $key, $value, $url ) {
		$separator = ( false === strpos( $url, '?' ) ) ? '?' : '&';
		return $url . $separator . rawurlencode( $key ) . '=' . rawurlencode( $value );
	}
}

if ( ! function_exists( 'wp_remote_get' ) ) {
	/**
	 * Stub of WordPress wp_remote_get() backed by
	 * $GLOBALS['_fair_test_remote_responses'][ $url ] (a raw response array
	 * with 'response' => [ 'code' => int ] and 'body' => string). Defaults to
	 * an HTTP 200 with an empty body when the URL is not seeded.
	 *
	 * @param string $url  URL to fetch.
	 * @param array  $args Request args (ignored by this stub).
	 * @return array Raw response array, matching the shape wp_remote_* readers expect.
	 */
	function wp_remote_get( $url, $args = array() ) {
		$responses = isset( $GLOBALS['_fair_test_remote_responses'] ) ? $GLOBALS['_fair_test_remote_responses'] : array();

		return array_key_exists( $url, $responses )
			? $responses[ $url ]
			: array(
				'response' => array( 'code' => 200 ),
				'body'     => '',
			);
	}
}

if ( ! function_exists( 'wp_safe_remote_get' ) ) {
	/**
	 * Stub of WordPress wp_safe_remote_get() — delegates to the wp_remote_get()
	 * stub above (this bootstrap has no notion of "unsafe" URL rejection;
	 * seed $GLOBALS['_fair_test_remote_responses'][ $url ] with a WP_Error to
	 * simulate that outcome).
	 *
	 * @param string $url  URL to fetch.
	 * @param array  $args Request args (ignored by this stub).
	 * @return array|WP_Error Raw response array, or a seeded WP_Error.
	 */
	function wp_safe_remote_get( $url, $args = array() ) {
		return wp_remote_get( $url, $args );
	}
}

if ( ! function_exists( 'wp_remote_retrieve_header' ) ) {
	/**
	 * Stub of WordPress wp_remote_retrieve_header() backed by a response
	 * array's 'headers' key (a plain associative array in test fixtures).
	 *
	 * @param array  $response Raw response array from wp_remote_get().
	 * @param string $header   Header name to read.
	 * @return string Header value, or empty string if absent.
	 */
	function wp_remote_retrieve_header( $response, $header ) {
		return isset( $response['headers'][ $header ] ) ? $response['headers'][ $header ] : '';
	}
}

if ( ! function_exists( 'is_wp_error' ) ) {
	/**
	 * Stub of WordPress is_wp_error() — no WP_Error stub class exists here, so
	 * this always returns false (the "instanceof" check against a class that
	 * doesn't exist is valid PHP and simply never matches).
	 *
	 * @param mixed $thing Value to check.
	 * @return bool Always false.
	 */
	function is_wp_error( $thing ) {
		return $thing instanceof \WP_Error;
	}
}

if ( ! function_exists( 'wp_remote_retrieve_response_code' ) ) {
	/**
	 * Stub of WordPress wp_remote_retrieve_response_code().
	 *
	 * @param array $response Raw response array from wp_remote_get().
	 * @return int HTTP status code, or 0 if absent.
	 */
	function wp_remote_retrieve_response_code( $response ) {
		return isset( $response['response']['code'] ) ? (int) $response['response']['code'] : 0;
	}
}

if ( ! function_exists( 'wp_remote_retrieve_body' ) ) {
	/**
	 * Stub of WordPress wp_remote_retrieve_body().
	 *
	 * @param array $response Raw response array from wp_remote_get().
	 * @return string Response body, or empty string if absent.
	 */
	function wp_remote_retrieve_body( $response ) {
		return isset( $response['body'] ) ? $response['body'] : '';
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub of WordPress __() — returns the string untranslated.
	 *
	 * @param string $text   Text to translate.
	 * @param string $domain Text domain (unused).
	 * @return string
	 */
	function __( $text, $domain = 'default' ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		return $text;
	}
}

if ( ! function_exists( 'esc_html__' ) ) {
	/**
	 * Stub of WordPress esc_html__().
	 *
	 * @param string $text   Text to translate/escape.
	 * @param string $domain Text domain (unused).
	 * @return string HTML-escaped text.
	 */
	function esc_html__( $text, $domain = 'default' ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		return esc_html( $text );
	}
}

if ( ! function_exists( 'esc_html' ) ) {
	/**
	 * Stub of WordPress esc_html().
	 *
	 * @param string $text Text to escape.
	 * @return string HTML-escaped text.
	 */
	function esc_html( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES );
	}
}

if ( ! function_exists( 'wp_specialchars_decode' ) ) {
	/**
	 * Stub of WordPress wp_specialchars_decode() — delegates to htmlspecialchars_decode().
	 *
	 * @param string $text        Text to decode.
	 * @param mixed  $quote_style Quote style (ignored by the stub).
	 * @return string Decoded text.
	 */
	function wp_specialchars_decode( $text, $quote_style = ENT_NOQUOTES ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- stub always decodes with ENT_QUOTES.
		return htmlspecialchars_decode( (string) $text, ENT_QUOTES );
	}
}

if ( ! function_exists( 'add_filter' ) ) {
	/**
	 * Stub of WordPress add_filter() — a no-op for test purposes; nothing in
	 * this bootstrap calls a real apply_filters() against registered filters.
	 *
	 * @param string   $hook_name     Hook name.
	 * @param callable $callback      Callback.
	 * @param int      $priority      Priority (unused by the stub).
	 * @param int      $accepted_args Number of accepted args (unused by the stub).
	 * @return true
	 */
	function add_filter( $hook_name, $callback, $priority = 10, $accepted_args = 1 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- no-op stub.
		return true;
	}
}

if ( ! function_exists( 'remove_filter' ) ) {
	/**
	 * Stub of WordPress remove_filter() — a no-op for test purposes.
	 *
	 * @param string   $hook_name Hook name.
	 * @param callable $callback  Callback.
	 * @param int      $priority  Priority (unused by the stub).
	 * @return true
	 */
	function remove_filter( $hook_name, $callback, $priority = 10 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- no-op stub.
		return true;
	}
}

if ( ! function_exists( 'number_format_i18n' ) ) {
	/**
	 * Stub of WordPress number_format_i18n() — delegates to PHP's number_format()
	 * without locale-specific separators, sufficient for deterministic tests.
	 *
	 * @param float $number   Number to format.
	 * @param int   $decimals Number of decimal points.
	 * @return string Formatted number.
	 */
	function number_format_i18n( $number, $decimals = 0 ) {
		return number_format( (float) $number, $decimals );
	}
}

if ( ! function_exists( 'get_transient' ) ) {
	/**
	 * Stub of WordPress get_transient() backed by $GLOBALS['_fair_test_transients'].
	 *
	 * @param string $key Transient key.
	 * @return mixed Stored value, or false when unset.
	 */
	function get_transient( $key ) {
		$transients = isset( $GLOBALS['_fair_test_transients'] ) ? $GLOBALS['_fair_test_transients'] : array();
		return array_key_exists( $key, $transients ) ? $transients[ $key ] : false;
	}
}

if ( ! function_exists( 'set_transient' ) ) {
	/**
	 * Stub of WordPress set_transient() backed by $GLOBALS['_fair_test_transients'].
	 * Expiration is ignored — tests that need expiry semantics unset the key
	 * directly on $GLOBALS['_fair_test_transients'].
	 *
	 * @param string $key        Transient key.
	 * @param mixed  $value      Value to store.
	 * @param int    $expiration Expiration in seconds (ignored by the stub).
	 * @return bool Always true.
	 */
	function set_transient( $key, $value, $expiration = 0 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- stub ignores expiry.
		if ( ! isset( $GLOBALS['_fair_test_transients'] ) ) {
			$GLOBALS['_fair_test_transients'] = array();
		}
		$GLOBALS['_fair_test_transients'][ $key ] = $value;
		return true;
	}
}

if ( ! function_exists( 'wp_mail' ) ) {
	/**
	 * Stub of WordPress wp_mail() recording each send into
	 * $GLOBALS['_fair_test_sent_emails'] so tests can assert on subject/message.
	 *
	 * @param string $to      Recipient email address.
	 * @param string $subject Email subject.
	 * @param string $message Email body.
	 * @return bool Always true.
	 */
	function wp_mail( $to, $subject, $message ) {
		if ( ! isset( $GLOBALS['_fair_test_sent_emails'] ) ) {
			$GLOBALS['_fair_test_sent_emails'] = array();
		}
		$GLOBALS['_fair_test_sent_emails'][] = array(
			'to'      => $to,
			'subject' => $subject,
			'message' => $message,
		);
		return true;
	}
}

require_once __DIR__ . '/wp-class-stubs.php';
require_once __DIR__ . '/wp-error-stub.php';
require_once __DIR__ . '/Fair_Test_WPDB.php';

// Global $wpdb double so model calls with a "not found" id (e.g. 0) resolve
// safely instead of fataling on a null global. See Fair_Test_WPDB's docblock.
// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
$GLOBALS['wpdb'] = new Fair_Test_WPDB();
