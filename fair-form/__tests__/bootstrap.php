<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairForm
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Define WordPress constants if not already defined.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

// Minimal WordPress function stubs for the code under test.
if ( ! function_exists( 'add_filter' ) ) {
	/**
	 * Stub of WordPress add_filter() — tests call callbacks directly, so
	 * registrations are not recorded.
	 *
	 * @return true
	 */
	function add_filter() {
		return true;
	}
}

if ( ! function_exists( 'add_action' ) ) {
	/**
	 * Stub of WordPress add_action() — see the add_filter() stub.
	 *
	 * @return true
	 */
	function add_action() {
		return true;
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

if ( ! function_exists( 'apply_filters' ) ) {
	/**
	 * Stub of WordPress apply_filters() — returns the value unfiltered, unless
	 * a test put a callback for the hook in $GLOBALS['_fair_test_filters'].
	 *
	 * @param string $hook_name Filter name.
	 * @param mixed  $value     Value to filter.
	 * @param mixed  ...$args   Further arguments passed to the callback.
	 * @return mixed
	 */
	function apply_filters( $hook_name, $value, ...$args ) {
		$filters = isset( $GLOBALS['_fair_test_filters'] ) ? $GLOBALS['_fair_test_filters'] : array();
		return isset( $filters[ $hook_name ] ) ? $filters[ $hook_name ]( $value, ...$args ) : $value;
	}
}

if ( ! defined( 'ARRAY_A' ) ) {
	define( 'ARRAY_A', 'ARRAY_A' );
}

if ( ! function_exists( 'remove_filter' ) ) {
	/**
	 * Stub of WordPress remove_filter() — see the add_filter() stub.
	 *
	 * @return true
	 */
	function remove_filter() {
		return true;
	}
}

if ( ! function_exists( 'do_action' ) ) {
	/**
	 * Stub of WordPress do_action() recording each call into
	 * $GLOBALS['_fair_test_actions'].
	 *
	 * @param string $hook_name Action name.
	 * @param mixed  ...$args   Action arguments.
	 */
	function do_action( $hook_name, ...$args ) {
		$GLOBALS['_fair_test_actions'][] = array( $hook_name, $args );
	}
}

if ( ! function_exists( 'is_email' ) ) {
	/**
	 * Stub of WordPress is_email().
	 *
	 * @param string $email Address to check.
	 * @return string|false The address when well-formed, false otherwise.
	 */
	function is_email( $email ) {
		return filter_var( $email, FILTER_VALIDATE_EMAIL );
	}
}

if ( ! function_exists( 'wp_specialchars_decode' ) ) {
	/**
	 * Stub of WordPress wp_specialchars_decode().
	 *
	 * @param string $text Text to decode.
	 * @return string Decoded text.
	 */
	function wp_specialchars_decode( $text ) {
		return htmlspecialchars_decode( (string) $text, ENT_QUOTES );
	}
}

if ( ! function_exists( 'get_post' ) ) {
	/**
	 * Stub of WordPress get_post() backed by $GLOBALS['_fair_test_posts'].
	 *
	 * @param int $post Post ID.
	 * @return object|null Stored post object or null.
	 */
	function get_post( $post ) {
		$posts = isset( $GLOBALS['_fair_test_posts'] ) ? $GLOBALS['_fair_test_posts'] : array();
		return isset( $posts[ $post ] ) ? $posts[ $post ] : null;
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

if ( ! function_exists( 'wp_get_attachment_url' ) ) {
	/**
	 * Stub of WordPress wp_get_attachment_url() backed by
	 * $GLOBALS['_fair_test_attachment_urls'].
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return string|false URL, or false when not seeded.
	 */
	function wp_get_attachment_url( $attachment_id ) {
		$urls = isset( $GLOBALS['_fair_test_attachment_urls'] ) ? $GLOBALS['_fair_test_attachment_urls'] : array();
		return isset( $urls[ $attachment_id ] ) ? $urls[ $attachment_id ] : false;
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

if ( ! function_exists( 'esc_attr' ) ) {
	/**
	 * Stub of WordPress esc_attr().
	 *
	 * @param string $value Raw value.
	 * @return string Attribute-escaped value.
	 */
	function esc_attr( $value ) {
		return htmlspecialchars( (string) $value, ENT_QUOTES );
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

if ( ! function_exists( 'wp_mail' ) ) {
	/**
	 * Stub of WordPress wp_mail() recording each send into
	 * $GLOBALS['_fair_test_sent_emails'].
	 *
	 * @param string $to      Recipient email address.
	 * @param string $subject Email subject.
	 * @param string $message Email body.
	 * @return bool Always true.
	 */
	function wp_mail( $to, $subject, $message ) {
		$GLOBALS['_fair_test_sent_emails'][] = array(
			'to'      => $to,
			'subject' => $subject,
			'message' => $message,
		);
		return true;
	}
}
