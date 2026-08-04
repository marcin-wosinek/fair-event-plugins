<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairAudience
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';
require_once __DIR__ . '/wp-error-stub.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

if ( ! defined( 'WEEK_IN_SECONDS' ) ) {
	define( 'WEEK_IN_SECONDS', 7 * 24 * 60 * 60 );
}

// Minimal WordPress function stubs so pure digest logic can be unit tested
// without a full WP bootstrap. Tests seed values via $GLOBALS['_fair_test_options'].
if ( ! function_exists( 'is_wp_error' ) ) {
	/**
	 * Stub of WordPress is_wp_error().
	 *
	 * @param mixed $thing Value to check.
	 * @return bool Whether $thing is a WP_Error instance.
	 */
	function is_wp_error( $thing ) {
		return $thing instanceof WP_Error;
	}
}

if ( ! function_exists( 'get_option' ) ) {
	/**
	 * Stub of WordPress get_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value Value returned when the option is unset.
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
	 *
	 * @param string $name  Option name.
	 * @param mixed  $value Value to store.
	 * @return bool Always true.
	 */
	function update_option( $name, $value ) {
		$GLOBALS['_fair_test_options'][ $name ] = $value;
		return true;
	}
}

if ( ! function_exists( 'add_filter' ) ) {
	/**
	 * Stub of WordPress add_filter() recording registrations into
	 * $GLOBALS['_fair_test_hooks'] so tests can assert on accepted_args.
	 *
	 * @param string   $hook_name     Hook name.
	 * @param callable $callback      Callback.
	 * @param int      $priority      Priority (unused by the stub).
	 * @param int      $accepted_args Number of accepted args.
	 * @return true
	 */
	function add_filter( $hook_name, $callback, $priority = 10, $accepted_args = 1 ) {
		$GLOBALS['_fair_test_hooks'][ $hook_name ][] = array(
			'callback'      => $callback,
			'accepted_args' => $accepted_args,
		);
		return true;
	}
}

if ( ! function_exists( 'add_action' ) ) {
	/**
	 * Stub of WordPress add_action(), delegating to the add_filter() stub —
	 * both record into the same $GLOBALS['_fair_test_hooks'] structure.
	 *
	 * @param string   $hook_name     Hook name.
	 * @param callable $callback      Callback.
	 * @param int      $priority      Priority (unused by the stub).
	 * @param int      $accepted_args Number of accepted args.
	 * @return true
	 */
	function add_action( $hook_name, $callback, $priority = 10, $accepted_args = 1 ) {
		return add_filter( $hook_name, $callback, $priority, $accepted_args );
	}
}

if ( ! function_exists( 'remove_filter' ) ) {
	/**
	 * Stub of WordPress remove_filter() — a no-op for test purposes; the
	 * add_filter() stub never wires callbacks into a real apply_filters().
	 *
	 * @param string   $hook_name Hook name.
	 * @param callable $callback  Callback.
	 * @param int      $priority  Priority (unused by the stub).
	 * @return true
	 */
	function remove_filter( $hook_name, $callback, $priority = 10 ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- no-op stub, kept param-compatible with the real signature.
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

if ( ! function_exists( 'get_post' ) ) {
	/**
	 * Stub of WordPress get_post() backed by $GLOBALS['_fair_test_posts'] (a
	 * map of post ID => object). Also passes through an already-object $post.
	 *
	 * @param int|object $post Post ID, or an already-built post-like object.
	 * @return object|null Stored post object, the passed object, or null.
	 */
	function get_post( $post ) {
		if ( is_object( $post ) ) {
			return $post;
		}
		$posts = isset( $GLOBALS['_fair_test_posts'] ) ? $GLOBALS['_fair_test_posts'] : array();
		return isset( $posts[ $post ] ) ? $posts[ $post ] : null;
	}
}

if ( ! function_exists( 'wp_specialchars_decode' ) ) {
	/**
	 * Stub of WordPress wp_specialchars_decode() — delegates to htmlspecialchars_decode().
	 *
	 * @param string $text  Text to decode.
	 * @param mixed  $quote_style Quote style (ignored by the stub).
	 * @return string Decoded text.
	 */
	function wp_specialchars_decode( $text, $quote_style = ENT_NOQUOTES ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- stub always decodes with ENT_QUOTES.
		return htmlspecialchars_decode( (string) $text, ENT_QUOTES );
	}
}

if ( ! function_exists( 'wp_date' ) ) {
	/**
	 * Stub of WordPress wp_date() — formats a timestamp in UTC, no locale/i18n handling.
	 *
	 * @param string   $format    date() format string.
	 * @param int|null $timestamp Unix timestamp; defaults to now.
	 * @return string Formatted date.
	 */
	function wp_date( $format, $timestamp = null ) {
		if ( null === $timestamp ) {
			$timestamp = time();
		}
		return gmdate( $format, $timestamp );
	}
}

if ( ! function_exists( 'current_time' ) ) {
	/**
	 * Stub of WordPress current_time(). Always returns UTC 'mysql' format.
	 *
	 * @return string Current time formatted for MySQL.
	 */
	function current_time() {
		return gmdate( 'Y-m-d H:i:s' );
	}
}

if ( ! function_exists( 'wp_timezone' ) ) {
	/**
	 * Stub of WordPress wp_timezone(), always UTC in tests.
	 *
	 * @return DateTimeZone
	 */
	function wp_timezone() {
		return new DateTimeZone( 'UTC' );
	}
}

if ( ! function_exists( 'sanitize_text_field' ) ) {
	/**
	 * Stub of WordPress sanitize_text_field().
	 *
	 * @param string $value Raw value.
	 * @return string Trimmed value with tags stripped.
	 */
	function sanitize_text_field( $value ) {
		return trim( wp_strip_all_tags( (string) $value ) );
	}
}

if ( ! function_exists( 'wp_strip_all_tags' ) ) {
	/**
	 * Stub of WordPress wp_strip_all_tags().
	 *
	 * @param string $value Raw value.
	 * @return string Value with tags removed.
	 */
	function wp_strip_all_tags( $value ) {
		return strip_tags( (string) $value ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- this *is* the wp_strip_all_tags() stub.
	}
}

if ( ! function_exists( 'sanitize_title' ) ) {
	/**
	 * Stub of WordPress sanitize_title().
	 *
	 * @param string $value Raw value.
	 * @return string Lowercased, hyphenated slug.
	 */
	function sanitize_title( $value ) {
		$value = strtolower( trim( (string) $value ) );
		$value = preg_replace( '/[^a-z0-9]+/', '-', $value );
		return trim( $value, '-' );
	}
}

if ( ! function_exists( 'wpautop' ) ) {
	/**
	 * Stub of WordPress wpautop() — wraps double-line-break-separated blocks
	 * in <p> tags, sufficient for deterministic tests.
	 *
	 * @param string $text Raw text.
	 * @return string Text with paragraphs wrapped in <p> tags.
	 */
	function wpautop( $text ) {
		$paragraphs = preg_split( '/\n\s*\n/', trim( (string) $text ) );
		return implode(
			'',
			array_map(
				function ( $paragraph ) {
					return '<p>' . trim( $paragraph ) . "</p>\n";
				},
				array_filter( $paragraphs, 'strlen' )
			)
		);
	}
}

if ( ! function_exists( 'wp_kses_post' ) ) {
	/**
	 * Stub of WordPress wp_kses_post() — passthrough for test purposes.
	 *
	 * @param string $value Raw HTML.
	 * @return string The same HTML, unmodified.
	 */
	function wp_kses_post( $value ) {
		return (string) $value;
	}
}

if ( ! function_exists( 'esc_html' ) ) {
	/**
	 * Stub of WordPress esc_html().
	 *
	 * @param string $value Raw value.
	 * @return string HTML-escaped value.
	 */
	function esc_html( $value ) {
		return htmlspecialchars( (string) $value, ENT_QUOTES );
	}
}

if ( ! function_exists( 'esc_html__' ) ) {
	/**
	 * Stub of WordPress esc_html__().
	 *
	 * @param string $text Text to translate/escape.
	 * @return string HTML-escaped text.
	 */
	function esc_html__( $text ) {
		return esc_html( $text );
	}
}

if ( ! function_exists( 'esc_url' ) ) {
	/**
	 * Stub of WordPress esc_url().
	 *
	 * @param string $url Raw URL.
	 * @return string Escaped URL.
	 */
	function esc_url( $url ) {
		return htmlspecialchars( (string) $url, ENT_QUOTES );
	}
}

if ( ! function_exists( 'wp_parse_url' ) ) {
	/**
	 * Stub of WordPress wp_parse_url() — delegates to PHP's parse_url().
	 *
	 * @param string   $url       URL to parse.
	 * @param int|null $component PHP_URL_* component, or null for all.
	 * @return mixed Parsed component, full array, or false on failure.
	 */
	function wp_parse_url( $url, $component = -1 ) {
		return -1 === $component ? parse_url( $url ) : parse_url( $url, $component ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- this *is* the wp_parse_url() stub.
	}
}

if ( ! function_exists( 'get_site_url' ) ) {
	/**
	 * Stub of WordPress get_site_url() backed by $GLOBALS['_fair_test_options'].
	 *
	 * Seed via `$GLOBALS['_fair_test_options']['siteurl']` to change it; defaults
	 * to 'https://example.test' so internal-vs-external host checks are
	 * deterministic in tests.
	 *
	 * @return string Site URL.
	 */
	function get_site_url() {
		$options = isset( $GLOBALS['_fair_test_options'] ) ? $GLOBALS['_fair_test_options'] : array();
		return isset( $options['siteurl'] ) ? $options['siteurl'] : 'https://example.test';
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

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub of WordPress __().
	 *
	 * @param string $text Text to translate.
	 * @return string The untranslated text.
	 */
	function __( $text ) {
		return $text;
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

if ( ! function_exists( 'get_permalink' ) ) {
	/**
	 * Stub of WordPress get_permalink() — a deterministic fake URL keyed on the post ID.
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
	 * Stub of WordPress get_the_title() backed by $GLOBALS['_fair_test_post_titles'].
	 *
	 * @param int $post_id Post ID.
	 * @return string Title, or '' if not seeded.
	 */
	function get_the_title( $post_id ) {
		$titles = isset( $GLOBALS['_fair_test_post_titles'] ) ? $GLOBALS['_fair_test_post_titles'] : array();
		return isset( $titles[ $post_id ] ) ? $titles[ $post_id ] : '';
	}
}

if ( ! function_exists( 'add_query_arg' ) ) {
	/**
	 * Stub of WordPress add_query_arg() — supports the two call shapes used in
	 * this codebase: a single key/value pair, or an associative array.
	 *
	 * @param string|array $key   Query arg key, or an associative array of args.
	 * @param string       $value Query arg value (when $key is a string).
	 * @param string       $url   Base URL.
	 * @return string URL with the query args appended.
	 */
	function add_query_arg( $key, $value = '', $url = '' ) {
		if ( is_array( $key ) ) {
			$args = $key;
			$url  = $value;
		} else {
			$args = array( $key => $value );
		}

		$separator = false === strpos( $url, '?' ) ? '?' : '&';
		return $url . $separator . http_build_query( $args );
	}
}

if ( ! function_exists( 'wp_salt' ) ) {
	/**
	 * Stub of WordPress wp_salt() — a fixed value, sufficient for deterministic
	 * HMAC signing in tests.
	 *
	 * @param string $scheme Salt scheme (ignored).
	 * @return string Fake salt.
	 */
	function wp_salt( $scheme = 'auth' ) {
		return 'test-salt';
	}
}
