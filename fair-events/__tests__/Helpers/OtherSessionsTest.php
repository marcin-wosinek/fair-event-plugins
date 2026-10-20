<?php
/**
 * Tests for OtherSessions.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\OtherSessions;
use FairEvents\Models\EventDates;

/**
 * Which sessions the Other Sessions block lists, and how each entry reads.
 *
 * Every case runs in Europe/Madrid, so end boundaries are site-local and
 * cross both daylight-saving changes. The query itself is exercised by the
 * block's E2E spec against a real database.
 */
class OtherSessionsTest extends TestCase {

	/**
	 * Master row ID seeded into the fake $wpdb for generated-session links.
	 */
	const MASTER_ID = 9100;

	/**
	 * Run every case in a timezone with daylight saving.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
	}

	/**
	 * Restore the default test timezone.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * Build a session row.
	 *
	 * @param int   $id    Row ID.
	 * @param array $props Property overrides.
	 * @return EventDates
	 */
	private function session( int $id, array $props = array() ): EventDates {
		$row                  = new EventDates();
		$row->id              = $id;
		$row->event_id        = $props['event_id'] ?? null;
		$row->occurrence_type = $props['occurrence_type'] ?? 'generated';
		$row->master_id       = 'generated' === $row->occurrence_type ? self::MASTER_ID : null;
		$row->status          = $props['status'] ?? 'active';
		$row->start_date      = array_key_exists( 'start_date', $props ) ? $props['start_date'] : '2026-10-15';
		$row->end_date        = $props['end_date'] ?? $row->start_date;
		$row->start_time      = $props['start_time'] ?? null;
		$row->end_time        = $props['end_time'] ?? null;
		$row->all_day         = $props['all_day'] ?? false;
		$row->link_type       = $props['link_type'] ?? 'post';
		$row->address         = $props['address'] ?? null;
		$row->attendance_mode = $props['attendance_mode'] ?? 'in_person';
		$row->joining_link    = $props['joining_link'] ?? null;
		$row->external_url    = $props['external_url'] ?? null;
		return $row;
	}

	/**
	 * An instant in the site timezone.
	 *
	 * @param string $local Site-local 'Y-m-d H:i:s'.
	 * @return \DateTimeImmutable
	 */
	private function at( string $local ): \DateTimeImmutable {
		return new \DateTimeImmutable( $local, new \DateTimeZone( 'Europe/Madrid' ) );
	}

	/**
	 * IDs of the listed sessions.
	 *
	 * @param EventDates[] $rows Candidates.
	 * @param string       $now  Site-local now.
	 * @param int          $exclude_id Excluded session.
	 * @param int          $limit Limit.
	 * @return int[]
	 */
	private function listed_ids( array $rows, string $now, int $exclude_id = 0, int $limit = 20 ): array {
		return array_map(
			static function ( EventDates $row ) {
				return (int) $row->id;
			},
			OtherSessions::select_listed( $rows, $exclude_id, $limit, $this->at( $now ) )
		);
	}

	/**
	 * Requested limits are clamped to 1–20, defaulting to 5.
	 *
	 * @return void
	 */
	public function test_clamp_limit() {
		$this->assertSame( 5, OtherSessions::clamp_limit( null ) );
		$this->assertSame( 5, OtherSessions::clamp_limit( 'many' ) );
		$this->assertSame( 1, OtherSessions::clamp_limit( 0 ) );
		$this->assertSame( 1, OtherSessions::clamp_limit( -3 ) );
		$this->assertSame( 7, OtherSessions::clamp_limit( '7' ) );
		$this->assertSame( 20, OtherSessions::clamp_limit( 500 ) );
	}

	/**
	 * End boundaries for each time combination, genuine midnight, all-day,
	 * multi-day and both daylight-saving changes.
	 *
	 * @return array<string, array{0: array, 1: string, 2: bool}>
	 */
	public static function boundary_cases(): array {
		$both       = array(
			'start_time' => '19:30:00',
			'end_time'   => '21:30:00',
		);
		$start_only = array( 'start_time' => '19:30:00' );
		$end_only   = array( 'end_time' => '21:30:00' );

		return array(
			'both times, before the end'          => array( $both, '2026-10-15 21:29:59', true ),
			'both times, at the end'              => array( $both, '2026-10-15 21:30:00', false ),
			'both times, ongoing'                 => array( $both, '2026-10-15 20:00:00', true ),
			'start only, late on its date'        => array( $start_only, '2026-10-15 23:59:59', true ),
			'start only, the next day'            => array( $start_only, '2026-10-16 00:00:00', false ),
			'end only, before the end'            => array( $end_only, '2026-10-15 21:29:59', true ),
			'end only, at the end'                => array( $end_only, '2026-10-15 21:30:00', false ),
			'no times, late on its date'          => array( array(), '2026-10-15 23:59:59', true ),
			'no times, the next day'              => array( array(), '2026-10-16 00:00:00', false ),
			'ends at genuine midnight, before'    => array(
				array(
					'start_time' => '22:00:00',
					'end_date'   => '2026-10-16',
					'end_time'   => '00:00:00',
				),
				'2026-10-15 23:59:59',
				true,
			),
			'ends at genuine midnight, at it'     => array(
				array(
					'start_time' => '22:00:00',
					'end_date'   => '2026-10-16',
					'end_time'   => '00:00:00',
				),
				'2026-10-16 00:00:00',
				false,
			),
			'all-day ignores stored times'        => array(
				array(
					'all_day'  => true,
					'end_time' => '09:00:00',
				),
				'2026-10-15 23:00:00',
				true,
			),
			'multi-day all-day, on its last day'  => array(
				array(
					'all_day'  => true,
					'end_date' => '2026-10-17',
				),
				'2026-10-17 23:59:59',
				true,
			),
			'multi-day all-day, after it'         => array(
				array(
					'all_day'  => true,
					'end_date' => '2026-10-17',
				),
				'2026-10-18 00:00:00',
				false,
			),
			'multi-day timed, ongoing'            => array(
				array(
					'start_time' => '10:00:00',
					'end_date'   => '2026-10-17',
					'end_time'   => '18:00:00',
				),
				'2026-10-16 12:00:00',
				true,
			),
			'not started yet'                     => array( $both, '2026-10-01 12:00:00', true ),
			'DST ends: untimed, late on its date' => array(
				array(
					'start_date' => '2026-10-25',
					'end_date'   => '2026-10-25',
				),
				'2026-10-25 23:59:59',
				true,
			),
			'DST ends: untimed, the next day'     => array(
				array(
					'start_date' => '2026-10-25',
					'end_date'   => '2026-10-25',
				),
				'2026-10-26 00:00:00',
				false,
			),
			'DST starts: end time after the gap'  => array(
				array(
					'start_date' => '2026-03-29',
					'end_date'   => '2026-03-29',
					'start_time' => '01:00:00',
					'end_time'   => '04:00:00',
				),
				'2026-03-29 03:59:59',
				true,
			),
			'DST starts: at its end time'         => array(
				array(
					'start_date' => '2026-03-29',
					'end_date'   => '2026-03-29',
					'start_time' => '01:00:00',
					'end_time'   => '04:00:00',
				),
				'2026-03-29 04:00:00',
				false,
			),
		);
	}

	/**
	 * A session is listed until its end boundary.
	 *
	 * @param array  $props    Session timing.
	 * @param string $now      Site-local now.
	 * @param bool   $expected Whether it is listed.
	 * @return void
	 */
	#[DataProvider( 'boundary_cases' )]
	public function test_lists_sessions_until_their_end_boundary( array $props, string $now, bool $expected ) {
		$listed = $this->listed_ids( array( $this->session( 1, $props ) ), $now );

		$this->assertSame( $expected ? array( 1 ) : array(), $listed );
	}

	/**
	 * The selected session, cancelled sessions and undated rows are left out.
	 *
	 * @return void
	 */
	public function test_excludes_selected_cancelled_and_undated_sessions() {
		$rows = array(
			$this->session( 1 ),
			$this->session( 2 ),
			$this->session( 3, array( 'status' => 'cancelled' ) ),
			$this->session( 4, array( 'start_date' => null ) ),
		);

		$this->assertSame( array( 1 ), $this->listed_ids( $rows, '2026-10-01 12:00:00', 2 ) );
	}

	/**
	 * Sessions sort by date, untimed first, then time, then ID, and the
	 * limit applies after exclusion.
	 *
	 * @return void
	 */
	public function test_orders_stably_and_applies_the_limit_after_exclusion() {
		$rows = array(
			$this->session( 7, array( 'start_date' => '2026-10-16' ) ),
			$this->session( 6, array( 'start_time' => '19:00:00' ) ),
			$this->session( 5, array( 'start_time' => '09:00:00' ) ),
			$this->session( 4 ),
			$this->session( 3, array( 'start_time' => '09:00:00' ) ),
			$this->session( 2, array( 'start_date' => '2026-10-14' ) ),
		);

		$this->assertSame( array( 2, 4, 3, 5, 6, 7 ), $this->listed_ids( $rows, '2026-10-01 12:00:00' ) );
		$this->assertSame( array( 4, 3, 5 ), $this->listed_ids( $rows, '2026-10-01 12:00:00', 2, 3 ) );
	}

	/**
	 * Date labels for each time combination: full date with year, only
	 * supplied times, a labelled end-only time, genuine midnight, all-day.
	 *
	 * @return array<string, array{0: array, 1: string, 2: bool}>
	 */
	public static function label_cases(): array {
		return array(
			'both times'          => array(
				array(
					'start_time' => '19:30:00',
					'end_time'   => '21:30:00',
				),
				'19:30—21:30, 15 October 2026',
				false,
			),
			'start only'          => array( array( 'start_time' => '19:30:00' ), '19:30, 15 October 2026', false ),
			'end only'            => array( array( 'end_time' => '21:30:00' ), 'Ends 21:30, 15 October 2026', false ),
			'no times'            => array( array(), '15 October 2026', false ),
			'genuine midnight'    => array( array( 'start_time' => '00:00:00' ), '00:00, 15 October 2026', false ),
			'multi-day, no times' => array( array( 'end_date' => '2026-10-17' ), '15–17 October 2026', false ),
			'multi-day, end only' => array(
				array(
					'end_date' => '2026-10-17',
					'end_time' => '12:00:00',
				),
				'15 October 2026—ends 12:00 17 October 2026',
				false,
			),
			'explicit all-day'    => array(
				array(
					'all_day'  => true,
					'end_date' => '2026-10-17',
				),
				'15–17 October 2026',
				true,
			),
			'all-day hides times' => array(
				array(
					'all_day'    => true,
					'start_time' => '00:00:00',
					'end_time'   => '00:00:00',
				),
				'15 October 2026',
				true,
			),
		);
	}

	/**
	 * Each entry shows its full date and only supplied times.
	 *
	 * @param array  $props   Session timing.
	 * @param string $date    Expected label.
	 * @param bool   $all_day Expected all-day mark.
	 * @return void
	 */
	#[DataProvider( 'label_cases' )]
	public function test_entry_labels( array $props, string $date, bool $all_day ) {
		$entry = OtherSessions::entry(
			$this->session(
				1,
				array_merge(
					$props,
					array(
						'occurrence_type' => 'master',
						'event_id'        => 10,
						'address'         => 'Calle Serie 1',
					)
				)
			),
			10
		);

		$this->assertSame( $date, $entry['date'] );
		$this->assertSame( $all_day, $entry['all_day'] );
	}

	/**
	 * The series' first session links to its own dated page, not the overview.
	 *
	 * @return void
	 */
	public function test_first_session_links_to_its_dated_page() {
		$entry = OtherSessions::entry(
			$this->session(
				1,
				array(
					'occurrence_type' => 'master',
					'event_id'        => 10,
					'address'         => 'Calle Serie 1',
				)
			),
			10
		);

		$this->assertSame( 'https://example.com/?p=10&event_date=2026-10-15', $entry['url'] );
	}

	/**
	 * A generated session links to the series' local page with its date,
	 * even when the series links elsewhere for calendars.
	 *
	 * @return void
	 */
	public function test_generated_session_links_to_the_local_series_page() {
		$GLOBALS['wpdb']->seed_row(
			'wp_fair_event_dates',
			self::MASTER_ID,
			(object) array(
				'id'              => self::MASTER_ID,
				'event_id'        => 10,
				'all_day'         => 0,
				'occurrence_type' => 'master',
				'master_id'       => null,
				'start_date'      => '2026-10-08',
				'end_date'        => '2026-10-08',
				'start_time'      => null,
				'end_time'        => null,
				'link_type'       => 'external',
				'external_url'    => 'https://partner.example.org/event',
				'address'         => 'Calle Serie 1',
			)
		);

		$entry = OtherSessions::entry(
			$this->session(
				2,
				array(
					'start_date'   => '2026-10-22',
					'link_type'    => 'external',
					'external_url' => 'https://partner.example.org/event',
					'address'      => 'Calle Cambio 2',
				)
			),
			10
		);

		$this->assertSame( 'https://example.com/?p=10&event_date=2026-10-22', $entry['url'] );
		$this->assertSame( 'Calle Cambio 2', $entry['location'] );
	}

	/**
	 * An online session shows its mode and no physical location.
	 *
	 * @return void
	 */
	public function test_online_session_entry() {
		$entry = OtherSessions::entry(
			$this->session(
				1,
				array(
					'occurrence_type' => 'master',
					'event_id'        => 10,
					'attendance_mode' => 'online',
					'joining_link'    => 'https://meet.example.org/x',
				)
			),
			0
		);

		$this->assertSame( 'online', $entry['mode'] );
		$this->assertSame( '', $entry['location'] );
	}
}
