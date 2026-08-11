<?php
/**
 * Tests for DatedViewCanonicalUrl::resolve_url().
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\DatedViewCanonicalUrl;

/**
 * Unit tests for the pure canonical-URL decision in DatedViewCanonicalUrl.
 */
class DatedViewCanonicalUrlTest extends TestCase {

	const BASE_URL = 'https://example.com/events/';

	const NOW_CALENDAR = array(
		'month' => '06',
		'year'  => '2026',
	);

	const NOW_WEEK = array(
		'year' => 2026,
		'week' => 24,
	);

	/**
	 * An in-window calendar param, with the calendar block present, gets its
	 * own canonical.
	 *
	 * @return void
	 */
	public function test_in_window_calendar_param_with_block_included() {
		$calendar = array(
			'month' => '08',
			'year'  => '2026',
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			true,
			$calendar,
			self::NOW_CALENDAR,
			false,
			null,
			self::NOW_WEEK
		);

		$this->assertSame(
			self::BASE_URL . '?calendar_month=08&calendar_year=2026',
			$result
		);
	}

	/**
	 * An in-window week param, with the week block present, gets its own
	 * canonical.
	 *
	 * @return void
	 */
	public function test_in_window_week_param_with_block_included() {
		$week = array(
			'year' => 2026,
			'week' => 30,
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			false,
			null,
			self::NOW_CALENDAR,
			true,
			$week,
			self::NOW_WEEK
		);

		$this->assertSame(
			self::BASE_URL . '?week_view=2026-W30',
			$result
		);
	}

	/**
	 * No params present: canonical stays the bare page URL.
	 *
	 * @return void
	 */
	public function test_no_params_keeps_bare_url() {
		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			true,
			null,
			self::NOW_CALENDAR,
			true,
			null,
			self::NOW_WEEK
		);

		$this->assertSame( self::BASE_URL, $result );
	}

	/**
	 * A param outside the supported window falls back to the bare page URL.
	 *
	 * @return void
	 */
	public function test_out_of_window_param_falls_back_to_bare_url() {
		$calendar = array(
			'month' => '01',
			'year'  => '2027', // 7 months out — beyond the ±3 month window.
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			true,
			$calendar,
			self::NOW_CALENDAR,
			false,
			null,
			self::NOW_WEEK
		);

		$this->assertSame( self::BASE_URL, $result );
	}

	/**
	 * A week param outside the ±12 week window falls back to the bare URL.
	 *
	 * @return void
	 */
	public function test_out_of_window_week_param_falls_back_to_bare_url() {
		$week = array(
			'year' => 2026,
			'week' => 40, // 16 weeks out — beyond the ±12 week window.
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			false,
			null,
			self::NOW_CALENDAR,
			true,
			$week,
			self::NOW_WEEK
		);

		$this->assertSame( self::BASE_URL, $result );
	}

	/**
	 * A param present in the request whose block is absent from the page is
	 * dropped from the canonical — the "leftover param" case.
	 *
	 * @return void
	 */
	public function test_param_without_its_block_is_dropped() {
		$calendar = array(
			'month' => '08',
			'year'  => '2026',
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			false, // Calendar block not on the page.
			$calendar,
			self::NOW_CALENDAR,
			false,
			null,
			self::NOW_WEEK
		);

		$this->assertSame( self::BASE_URL, $result );
	}

	/**
	 * Both blocks present, only one param in-window: only the relevant one
	 * is included.
	 *
	 * @return void
	 */
	public function test_both_blocks_present_only_relevant_param_included() {
		$calendar = array(
			'month' => '08',
			'year'  => '2026',
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			true,
			$calendar,
			self::NOW_CALENDAR,
			true,
			null, // No week param on this request.
			self::NOW_WEEK
		);

		$this->assertSame(
			self::BASE_URL . '?calendar_month=08&calendar_year=2026',
			$result
		);
	}

	/**
	 * A calendar param matching "now" is the default view, so it collapses
	 * to the bare URL even with the block present.
	 *
	 * @return void
	 */
	public function test_calendar_param_matching_now_keeps_bare_url() {
		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			true,
			self::NOW_CALENDAR,
			self::NOW_CALENDAR,
			false,
			null,
			self::NOW_WEEK
		);

		$this->assertSame( self::BASE_URL, $result );
	}

	/**
	 * A week param matching "now" is the default view, so it collapses to
	 * the bare URL even with the block present.
	 *
	 * @return void
	 */
	public function test_week_param_matching_now_keeps_bare_url() {
		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			false,
			null,
			self::NOW_CALENDAR,
			true,
			self::NOW_WEEK,
			self::NOW_WEEK
		);

		$this->assertSame( self::BASE_URL, $result );
	}

	/**
	 * Both blocks present with in-window, non-default params: both survive
	 * in the canonical URL.
	 *
	 * @return void
	 */
	public function test_both_params_included_when_both_in_window() {
		$calendar = array(
			'month' => '08',
			'year'  => '2026',
		);
		$week     = array(
			'year' => 2026,
			'week' => 30,
		);

		$result = DatedViewCanonicalUrl::resolve_url(
			self::BASE_URL,
			true,
			$calendar,
			self::NOW_CALENDAR,
			true,
			$week,
			self::NOW_WEEK
		);

		$this->assertSame(
			self::BASE_URL . '?calendar_month=08&calendar_year=2026&week_view=2026-W30',
			$result
		);
	}
}
