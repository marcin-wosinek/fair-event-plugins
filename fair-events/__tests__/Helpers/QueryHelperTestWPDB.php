<?php
/**
 * Minimal $wpdb double for QueryHelperTest, whose prepare() returns a real
 * interpolated string (Fair_Test_WPDB's shared stub returns an array, built
 * for get_row()-style lookups, which doesn't suit QueryHelper's
 * `$where .= $wpdb->prepare(...)` string-concatenation usage).
 *
 * @package FairEvents
 */

/**
 * $wpdb double whose prepare() substitutes placeholders in order.
 */
class QueryHelperTestWPDB {

	/**
	 * Table prefix, matching WordPress's default.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Posts table name, matching wpdb's real public property.
	 *
	 * @var string
	 */
	public $posts = 'wp_posts';

	/**
	 * Substitute %s/%d/%f placeholders in order, quoting strings — close
	 * enough to wpdb::prepare() for asserting on the resulting SQL fragment.
	 *
	 * @param string $query   Query with placeholders.
	 * @param mixed  ...$args Values for the placeholders.
	 * @return string Interpolated query.
	 */
	public function prepare( $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}

		foreach ( $args as $arg ) {
			$replacement = is_string( $arg ) ? "'" . $arg . "'" : (string) $arg;
			$query       = preg_replace( '/%[sdf]/', str_replace( '$', '\\$', $replacement ), $query, 1 );
		}

		return $query;
	}
}
