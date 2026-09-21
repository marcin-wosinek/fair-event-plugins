<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairPaymentsConnectorExperimental
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// WordPress constant stubs.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}

if ( ! function_exists( 'esc_html' ) ) {
	/**
	 * Stub of WordPress esc_html() — returns the string unescaped.
	 *
	 * @param string $text Text to escape.
	 * @return string
	 */
	function esc_html( $text ) {
		return (string) $text;
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

if ( ! function_exists( 'number_format_i18n' ) ) {
	/**
	 * Stub of WordPress number_format_i18n() — delegates to number_format()
	 * since tests run under the default (no locale-specific separators) case.
	 *
	 * @param float $number   Number to format.
	 * @param int   $decimals Number of decimal places.
	 * @return string
	 */
	function number_format_i18n( $number, $decimals = 0 ) {
		return number_format( (float) $number, $decimals );
	}
}

// Time constants WordPress defines before plugins load.
foreach (
	array(
		'MINUTE_IN_SECONDS' => 60,
		'HOUR_IN_SECONDS'   => 3600,
		'DAY_IN_SECONDS'    => 86400,
		'WEEK_IN_SECONDS'   => 604800,
	) as $fair_test_constant => $fair_test_seconds
) {
	if ( ! defined( $fair_test_constant ) ) {
		define( $fair_test_constant, $fair_test_seconds );
	}
}

if ( ! function_exists( '__' ) ) {
	/**
	 * Stub of WordPress __() — returns the text untranslated.
	 *
	 * @param string $text Text to translate.
	 * @return string
	 */
	function __( $text ) {
		return (string) $text;
	}
}

if ( ! function_exists( 'get_option' ) ) {
	/**
	 * Stub of WordPress get_option() backed by $GLOBALS['_fair_test_options'].
	 *
	 * @param string $name          Option name.
	 * @param mixed  $default_value Value when the option is unset.
	 * @return mixed
	 */
	function get_option( $name, $default_value = false ) {
		return $GLOBALS['_fair_test_options'][ $name ] ?? $default_value;
	}
}

if ( ! function_exists( 'add_action' ) ) {
	/**
	 * Stub of WordPress add_action() — hooks are not run in unit tests.
	 *
	 * @return bool
	 */
	function add_action() {
		return true;
	}
}

if ( ! function_exists( 'add_filter' ) ) {
	/**
	 * Stub of WordPress add_filter() — hooks are not run in unit tests.
	 *
	 * @return bool
	 */
	function add_filter() {
		return true;
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	/**
	 * Stub of WordPress apply_filters() — returns the value unfiltered.
	 *
	 * @param string $hook_name Filter name.
	 * @param mixed  $value     Value to filter.
	 * @return mixed
	 */
	function apply_filters( $hook_name, $value ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- stub keeps the real signature.
		return $value;
	}
}

if ( ! function_exists( 'home_url' ) ) {
	/**
	 * Stub of WordPress home_url().
	 *
	 * @return string
	 */
	function home_url() {
		return 'https://example.test';
	}
}

if ( ! function_exists( 'wp_parse_url' ) ) {
	/**
	 * Stub of WordPress wp_parse_url().
	 *
	 * @param string $url       URL to parse.
	 * @param int    $component Component to return.
	 * @return mixed
	 */
	function wp_parse_url( $url, $component = -1 ) {
		return parse_url( $url, $component ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- this stub is the wrapper.
	}
}

if ( ! function_exists( 'current_time' ) ) {
	/**
	 * Stub of WordPress current_time() — always a GMT MySQL datetime.
	 *
	 * @return string
	 */
	function current_time() {
		return gmdate( 'Y-m-d H:i:s' );
	}
}

if ( ! function_exists( 'wp_schedule_single_event' ) ) {
	/**
	 * Stub of WordPress wp_schedule_single_event() — records the event.
	 *
	 * @param int    $timestamp Run time.
	 * @param string $hook      Hook name.
	 * @param array  $args      Hook arguments.
	 * @return bool
	 */
	function wp_schedule_single_event( $timestamp, $hook, $args = array() ) {
		$GLOBALS['_fair_test_single_events'][] = array(
			'timestamp' => $timestamp,
			'hook'      => $hook,
			'args'      => $args,
		);
		return true;
	}
}

if ( ! function_exists( 'wp_next_scheduled' ) ) {
	/**
	 * Stub of WordPress wp_next_scheduled() over $GLOBALS['_fair_test_cron'].
	 *
	 * @param string $hook Hook name.
	 * @param array  $args Hook arguments.
	 * @return int|false
	 */
	function wp_next_scheduled( $hook, $args = array() ) {
		foreach ( $GLOBALS['_fair_test_cron'] ?? array() as $event ) {
			if ( $event['hook'] === $hook && $event['args'] === $args ) {
				return $event['timestamp'];
			}
		}
		return false;
	}
}

if ( ! function_exists( 'wp_schedule_event' ) ) {
	/**
	 * Stub of WordPress wp_schedule_event() — records the recurring event.
	 *
	 * @param int    $timestamp  First run time.
	 * @param string $recurrence Schedule name.
	 * @param string $hook       Hook name.
	 * @param array  $args       Hook arguments.
	 * @return bool
	 */
	function wp_schedule_event( $timestamp, $recurrence, $hook, $args = array() ) {
		$GLOBALS['_fair_test_cron'][] = array(
			'timestamp'  => $timestamp,
			'recurrence' => $recurrence,
			'hook'       => $hook,
			'args'       => $args,
		);
		return true;
	}
}

if ( ! function_exists( 'wp_clear_scheduled_hook' ) ) {
	/**
	 * Stub of WordPress wp_clear_scheduled_hook() — removes events whose hook
	 * and arguments match exactly.
	 *
	 * @param string $hook Hook name.
	 * @param array  $args Hook arguments.
	 * @return int
	 */
	function wp_clear_scheduled_hook( $hook, $args = array() ) {
		$before                     = count( $GLOBALS['_fair_test_cron'] ?? array() );
		$GLOBALS['_fair_test_cron'] = array_values(
			array_filter(
				$GLOBALS['_fair_test_cron'] ?? array(),
				function ( $event ) use ( $hook, $args ) {
					return ! ( $event['hook'] === $hook && $event['args'] === $args );
				}
			)
		);
		return $before - count( $GLOBALS['_fair_test_cron'] );
	}
}
