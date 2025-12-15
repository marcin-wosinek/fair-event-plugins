<?php
/**
 * Debug logging utility
 *
 * Provides safe debug logging that only runs when WP_DEBUG is enabled.
 *
 * @package FairMembership
 */

namespace FairMembership\Utils;

defined( 'WPINC' ) || die;

/**
 * Debug logging utility class
 *
 * Centralizes all debug logging with WP_DEBUG checks and phpcs suppressions.
 */
class DebugLogger {

	/**
	 * Log a debug message
	 *
	 * Only logs when WP_DEBUG is enabled. Automatically formats arrays and objects.
	 *
	 * @param mixed  $message Message to log (string, array, or object).
	 * @param string $prefix  Optional prefix for the log message.
	 * @return void
	 */
	public static function log( $message, $prefix = '' ) {
		if ( ! defined( 'WP_DEBUG' ) || ! WP_DEBUG ) {
			return;
		}

		$formatted_message = self::format_message( $message, $prefix );

		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- This utility is specifically for debug logging
		error_log( $formatted_message );
	}

	/**
	 * Format message for logging
	 *
	 * @param mixed  $message Message to format.
	 * @param string $prefix  Optional prefix.
	 * @return string Formatted message.
	 */
	private static function format_message( $message, $prefix = '' ) {
		$prefix_string = $prefix ? "[{$prefix}] " : '';

		if ( is_array( $message ) || is_object( $message ) ) {
      // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_print_r -- This utility is specifically for debug logging
			return $prefix_string . print_r( $message, true );
		}

		return $prefix_string . $message;
	}

	/**
	 * Log an error message
	 *
	 * Similar to log() but with an [ERROR] prefix.
	 *
	 * @param mixed $message Message to log.
	 * @return void
	 */
	public static function error( $message ) {
		self::log( $message, 'ERROR' );
	}

	/**
	 * Log a warning message
	 *
	 * Similar to log() but with a [WARNING] prefix.
	 *
	 * @param mixed $message Message to log.
	 * @return void
	 */
	public static function warning( $message ) {
		self::log( $message, 'WARNING' );
	}

	/**
	 * Log an info message
	 *
	 * Similar to log() but with an [INFO] prefix.
	 *
	 * @param mixed $message Message to log.
	 * @return void
	 */
	public static function info( $message ) {
		self::log( $message, 'INFO' );
	}

	/**
	 * Log a debug message with context
	 *
	 * Logs a message along with additional context data.
	 *
	 * @param string $message Message to log.
	 * @param array  $context Additional context data.
	 * @return void
	 */
	public static function log_with_context( $message, $context = array() ) {
		if ( ! defined( 'WP_DEBUG' ) || ! WP_DEBUG ) {
			return;
		}

		self::log( $message );
		if ( ! empty( $context ) ) {
			self::log( $context, 'CONTEXT' );
		}
	}
}
