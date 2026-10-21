<?php
/**
 * Fake $wpdb for ProtectedOptions::convert().
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Settings;

/**
 * Fake $wpdb that applies ProtectedOptions::convert()'s compare-and-swap
 * UPDATE to the stubbed options.
 */
class Fair_Test_Options_WPDB {
	/**
	 * Options table name.
	 *
	 * @var string
	 */
	public $options = 'wp_options';

	/**
	 * Value written by a concurrent request just before the UPDATE runs.
	 *
	 * @var string|null
	 */
	public $concurrent_write = null;

	/**
	 * Return the arguments for query().
	 *
	 * @param string $query Query.
	 * @param mixed  ...$args Arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		return $args;
	}

	/**
	 * Apply the conditional update.
	 *
	 * @param array $args Table, new value, option name, expected value.
	 * @return int Rows changed.
	 */
	public function query( $args ) {
		list( , $value, $option, $expected ) = $args;

		if ( null !== $this->concurrent_write ) {
			$GLOBALS['_fair_test_options'][ $option ] = $this->concurrent_write;
		}

		if ( ( $GLOBALS['_fair_test_options'][ $option ] ?? null ) !== $expected ) {
			return 0;
		}

		$GLOBALS['_fair_test_options'][ $option ] = $value;
		return 1;
	}
}
