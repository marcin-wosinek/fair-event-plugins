<?php
/**
 * Tests for CanonicalUrl::resolve_url().
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\CanonicalUrl;
use FairEvents\Models\EventDates;

/**
 * Unit tests for the pure canonical-URL decision in CanonicalUrl.
 */
class CanonicalUrlTest extends TestCase {

	/**
	 * Build a minimal EventDates stub.
	 *
	 * @param array $props Associative array of property overrides.
	 * @return EventDates
	 */
	private function make_row( array $props ): EventDates {
		$row                 = new EventDates();
		$row->id             = $props['id'] ?? 1;
		$row->start_datetime = $props['start_datetime'] ?? '2026-07-01 10:00:00';
		return $row;
	}

	/**
	 * When the selected occurrence is the page's default (no param, or a
	 * param that resolves to the pivot), the base URL is returned unchanged.
	 *
	 * @return void
	 */
	public function test_default_occurrence_keeps_base_url() {
		$pivot    = $this->make_row( array( 'id' => 5 ) );
		$selected = $this->make_row( array( 'id' => 5 ) );

		$result = CanonicalUrl::resolve_url( 'https://example.com/event/', $selected, $pivot );

		$this->assertSame( 'https://example.com/event/', $result );
	}

	/**
	 * A non-default occurrence gets its own canonical: the base URL plus a
	 * normalized `event_date` param.
	 *
	 * @return void
	 */
	public function test_non_default_occurrence_gets_event_date_param() {
		$pivot    = $this->make_row(
			array(
				'id'             => 5,
				'start_datetime' => '2026-07-01 10:00:00',
			)
		);
		$selected = $this->make_row(
			array(
				'id'             => 6,
				'start_datetime' => '2026-07-08 10:00:00',
			)
		);

		$result = CanonicalUrl::resolve_url( 'https://example.com/event/', $selected, $pivot );

		$this->assertSame( 'https://example.com/event/?event_date=2026-07-08', $result );
	}

	/**
	 * A legacy-id-resolved row and a date-resolved row pointing at the same
	 * occurrence produce an identical canonical URL, since both share the
	 * same id/start_datetime once resolved.
	 *
	 * @return void
	 */
	public function test_legacy_and_date_resolved_rows_produce_identical_canonical() {
		$pivot = $this->make_row(
			array(
				'id'             => 5,
				'start_datetime' => '2026-07-01 10:00:00',
			)
		);

		$via_legacy_id  = $this->make_row(
			array(
				'id'             => 6,
				'start_datetime' => '2026-07-08 10:00:00',
			)
		);
		$via_date_param = $this->make_row(
			array(
				'id'             => 6,
				'start_datetime' => '2026-07-08 10:00:00',
			)
		);

		$result_a = CanonicalUrl::resolve_url( 'https://example.com/event/', $via_legacy_id, $pivot );
		$result_b = CanonicalUrl::resolve_url( 'https://example.com/event/', $via_date_param, $pivot );

		$this->assertSame( $result_a, $result_b );
	}

	/**
	 * An invalid/unrelated param resolves to the pivot itself (per
	 * SelectedOccurrence::resolve()'s fallback), so the canonical stays the
	 * base URL.
	 *
	 * @return void
	 */
	public function test_selected_equal_to_pivot_keeps_base_url_regardless_of_object_identity() {
		$pivot    = $this->make_row( array( 'id' => 7 ) );
		$selected = $this->make_row( array( 'id' => 7 ) );

		$result = CanonicalUrl::resolve_url( 'https://example.com/event/?utm_source=x', $selected, $pivot );

		$this->assertSame( 'https://example.com/event/?utm_source=x', $result );
	}
}
