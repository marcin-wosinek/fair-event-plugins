<?php
/**
 * Minimal FairEvents\Models\EventDates stand-in, loaded only by tests that
 * run in a separate process so the class_exists() guards elsewhere keep
 * their no-fair-events behavior.
 *
 * @package FairAudience
 */

namespace FairEvents\Models;

/**
 * Resolves every event date to one occurrence with a public URL.
 */
class EventDates {

	/**
	 * Public URL returned by every stubbed occurrence.
	 */
	public const URL = 'https://example.com/events/spring/?date=12';

	/**
	 * Start date; empty so no date formatting is attempted.
	 *
	 * @var string
	 */
	public $start_date = '';

	/**
	 * Look up an event date.
	 *
	 * @param int $id Event date ID.
	 * @return self
	 */
	public static function get_by_id( $id ) {
		unset( $id );
		return new self();
	}

	/**
	 * Public URL of this occurrence.
	 *
	 * @return string
	 */
	public function get_display_url() {
		return self::URL;
	}
}
