<?php
/**
 * Minimal WP_Query double for QueryHelperTest, exposing only what
 * QueryHelper reads.
 *
 * @package FairEvents
 */

/**
 * WP_Query double exposing query_vars and get().
 */
class QueryHelperTestQuery {

	/**
	 * Raw query vars, as WP_Query exposes them publicly.
	 *
	 * @var array
	 */
	public $query_vars;

	/**
	 * Construct the double.
	 *
	 * @param array $query_vars Query vars to expose.
	 */
	public function __construct( array $query_vars ) {
		$this->query_vars = $query_vars;
	}

	/**
	 * Mirrors WP_Query::get().
	 *
	 * @param string $key Query var key.
	 * @return mixed Value, or false if unset.
	 */
	public function get( $key ) {
		return $this->query_vars[ $key ] ?? false;
	}
}
