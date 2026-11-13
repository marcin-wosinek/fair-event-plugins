<?php
/**
 * $wpdb double for FormNotificationService tests.
 *
 * @package FairForm
 */

namespace FairForm\Tests\Services\Fakes;

/**
 * Minimal $wpdb double serving one submission row and its answer rows.
 */
class FakeNotificationWpdb {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Submission row returned by get_row(), or null.
	 *
	 * @var array|null
	 */
	public $submission;

	/**
	 * Answer rows returned by get_results().
	 *
	 * @var array
	 */
	public $answers = array();

	/**
	 * Return the query unchanged; the double ignores SQL.
	 *
	 * @param string $query Query.
	 * @return string
	 */
	public function prepare( $query ) {
		return $query;
	}

	/**
	 * Return the seeded submission row.
	 *
	 * @return array|null
	 */
	public function get_row() {
		return $this->submission;
	}

	/**
	 * Return the seeded answer rows.
	 *
	 * @return array
	 */
	public function get_results() {
		return $this->answers;
	}
}
