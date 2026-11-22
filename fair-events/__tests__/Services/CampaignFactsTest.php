<?php
/**
 * CampaignFacts unit tests (#2420): normalization of the facts, and source
 * read failures staying errors instead of becoming unknown values.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited
// phpcs:disable Squiz.Commenting.FunctionComment.Missing

use FairEvents\Models\EventDates;
use FairEvents\Models\Venue;
use FairEvents\Services\CampaignFacts;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use ReflectionProperty;
use WP_Error;

/**
 * $wpdb double: rows by table and id, junction links by event date, and a
 * table whose reads fail with `last_error` set.
 */
class Campaign_Facts_Test_WPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Error of the last query, as wpdb reports it.
	 *
	 * @var string
	 */
	public $last_error = '';

	/**
	 * Rows by table, then id.
	 *
	 * @var array<string, array<int, object>>
	 */
	public $rows = array();

	/**
	 * Linked post IDs by event date ID.
	 *
	 * @var array<int, int[]>
	 */
	public $links = array();

	/**
	 * Tables (or `table:id` rows) whose reads fail.
	 *
	 * @var string[]
	 */
	public $failing = array();

	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'table' => $args[0],
			'id'    => (int) $args[1],
		);
	}

	public function get_row( $prepared ) {
		if ( $this->fails( $prepared ) ) {
			return null;
		}

		return $this->rows[ $prepared['table'] ][ $prepared['id'] ] ?? null;
	}

	public function get_col( $prepared ) {
		if ( $this->fails( $prepared ) ) {
			return array();
		}

		return $this->links[ $prepared['id'] ] ?? array();
	}

	private function fails( $prepared ) {
		$fails            = in_array( $prepared['table'], $this->failing, true )
			|| in_array( $prepared['table'] . ':' . $prepared['id'], $this->failing, true );
		$this->last_error = $fails ? 'Lost connection' : '';

		return '' !== $this->last_error;
	}
}

/**
 * Tests CampaignFacts.
 */
class CampaignFactsTest extends TestCase {

	/**
	 * Fake database.
	 *
	 * @var Campaign_Facts_Test_WPDB
	 */
	private $db;

	protected function setUp(): void {
		$this->db                       = new Campaign_Facts_Test_WPDB();
		$GLOBALS['wpdb']                = $this->db;
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';
		( new ReflectionProperty( EventDates::class, 'master_cache' ) )->setValue( null, array() );
	}

	protected function tearDown(): void {
		unset( $GLOBALS['wpdb'], $GLOBALS['_fair_test_timezone'] );
		( new ReflectionProperty( EventDates::class, 'master_cache' ) )->setValue( null, array() );
	}

	private function event_date( $id, array $columns = array() ) {
		$this->db->rows['wp_fair_event_dates'][ $id ] = (object) array_merge(
			array(
				'id'                 => $id,
				'event_id'           => null,
				'all_day'            => 0,
				'start_date'         => '2037-05-10',
				'end_date'           => '2037-05-10',
				'start_time'         => '10:00:00',
				'end_time'           => '12:00:00',
				'occurrence_type'    => 'single',
				'master_id'          => null,
				'status'             => 'active',
				'publication_status' => 'publish',
				'venue_id'           => null,
				'title'              => 'Rock &amp; Roll',
				'link_type'          => 'none',
				'attendance_mode'    => null,
				'joining_link'       => 'https://meet.example.com/private',
				'address'            => 'Free text street 1',
				'external_url'       => 'https://partner.example.com',
			),
			$columns
		);
	}

	private function venue( $id, array $columns = array() ) {
		$this->db->rows['wp_fair_event_venues'][ $id ] = (object) array_merge(
			array(
				'id'                 => $id,
				'name'               => 'Hall',
				'address'            => null,
				'latitude'           => null,
				'longitude'          => null,
				'facebook_page_link' => null,
				'instagram_handle'   => null,
				'website_url'        => null,
				'created_at'         => '2026-01-01 00:00:00',
				'updated_at'         => '2026-01-01 00:00:00',
			),
			$columns
		);
	}

	public function test_reads_a_standalone_event_without_operational_fields() {
		$this->event_date( 1 );

		$this->assertSame(
			array(
				'eventDateId' => 1,
				'event'       => array(
					'title'             => 'Rock & Roll',
					'contentLanguage'   => null,
					'status'            => 'active',
					'publicationStatus' => 'publish',
					'attendanceMode'    => 'in_person',
					'timing'            => array(
						'timezone'  => 'Europe/Madrid',
						'allDay'    => false,
						'startDate' => '2037-05-10',
						'endDate'   => '2037-05-10',
						'startTime' => '10:00:00',
						'endTime'   => '12:00:00',
					),
					'venueId'           => null,
					'urls'              => array(
						'event'   => null,
						'booking' => null,
					),
				),
				'venues'      => array(),
			),
			CampaignFacts::read( 1 )
		);
	}

	public function test_generated_occurrence_inherits_from_its_master() {
		$this->event_date(
			1,
			array(
				'occurrence_type'    => 'master',
				'publication_status' => 'draft',
				'attendance_mode'    => 'online',
				'venue_id'           => 7,
				'title'              => 'Series',
			)
		);
		$this->event_date(
			2,
			array(
				'occurrence_type' => 'generated',
				'master_id'       => 1,
				'status'          => 'cancelled',
				'start_date'      => '2037-05-17',
				'end_date'        => '2037-05-17',
				'title'           => null,
				'attendance_mode' => null,
				'venue_id'        => null,
			)
		);
		$this->venue( 7 );
		$this->db->links[1] = array( 42 );

		$facts = CampaignFacts::read( 2 );

		$this->assertSame( 2, $facts['eventDateId'] );
		$this->assertSame( 'Series', $facts['event']['title'] );
		$this->assertSame( 'cancelled', $facts['event']['status'] );
		$this->assertSame( 'draft', $facts['event']['publicationStatus'] );
		$this->assertSame( 'online', $facts['event']['attendanceMode'] );
		$this->assertSame( 'venue:7', $facts['event']['venueId'] );
		$this->assertSame( 'https://example.com/?p=42&event_date=2037-05-17', $facts['event']['urls']['event'] );
		$this->assertSame( 'venue:7', $facts['venues'][0]['id'] );
	}

	public function test_missing_event_date_is_not_found() {
		$this->assertSame( 404, CampaignFacts::read( 99 )->get_error_data()['status'] );
	}

	public static function source_failures() {
		return array(
			'event date read fails'  => array( 'wp_fair_event_dates', array(), 'fair_events_source_unavailable' ),
			'linked page read fails' => array( 'wp_fair_event_date_posts', array(), 'fair_events_source_unavailable' ),
			'venue read fails'       => array( 'wp_fair_event_venues', array( 'venue_id' => 7 ), 'fair_events_source_unavailable' ),
			'venue is missing'       => array( null, array( 'venue_id' => 8 ), 'fair_events_venue_missing' ),
			'master is missing'      => array(
				null,
				array(
					'occurrence_type' => 'generated',
					'master_id'       => 50,
				),
				'fair_events_series_master_missing',
			),
			'master is unset'        => array( null, array( 'occurrence_type' => 'generated' ), 'fair_events_series_master_missing' ),
			'title is empty'         => array( null, array( 'title' => '&nbsp; ' ), 'fair_events_campaign_facts_title_missing' ),
			'status is unknown'      => array( null, array( 'status' => 'postponed' ), 'fair_events_campaign_facts_invalid_status' ),
			'mode is unknown'        => array( null, array( 'attendance_mode' => 'virtual' ), 'fair_events_campaign_facts_invalid_status' ),
		);
	}

	#[DataProvider( 'source_failures' )]
	public function test_source_failures_are_errors( $failing_table, array $columns, $code ) {
		$this->event_date( 1, $columns );
		$this->venue( 7 );
		if ( $failing_table ) {
			$this->db->failing[] = $failing_table;
		}

		$result = CampaignFacts::read( 1 );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( $code, $result->get_error_code() );
	}

	public function test_master_read_failure_is_an_error() {
		$this->event_date(
			2,
			array(
				'occurrence_type' => 'generated',
				'master_id'       => 1,
			)
		);
		$this->db->failing[] = 'wp_fair_event_dates:1';

		$this->assertSame( 'fair_events_source_unavailable', EventDates::get_by_id_checked( 2 )->get_error_code() );
	}

	public static function timings() {
		$undated = array(
			'start_date' => null,
			'end_date'   => null,
			'start_time' => null,
			'end_time'   => null,
		);

		return array(
			'undated'           => array( $undated + array( 'all_day' => false ), array( false, null, null, null, null ) ),
			'undated all-day'   => array( $undated + array( 'all_day' => true ), array( false, null, null, null, null ) ),
			'multi-day all-day' => array(
				array(
					'start_date' => '2037-07-01',
					'end_date'   => '2037-07-03',
					'start_time' => null,
					'end_time'   => null,
					'all_day'    => true,
				),
				array( true, '2037-07-01', '2037-07-03', null, null ),
			),
			'start time only'   => array(
				array(
					'start_date' => '2037-07-01',
					'end_date'   => '2037-07-01',
					'start_time' => '10:00:00',
					'end_time'   => null,
					'all_day'    => false,
				),
				array( false, '2037-07-01', '2037-07-01', '10:00:00', null ),
			),
			'end time only'     => array(
				array(
					'start_date' => '2037-07-01',
					'end_date'   => '2037-07-01',
					'start_time' => null,
					'end_time'   => '12:00:00',
					'all_day'    => false,
				),
				array( false, '2037-07-01', '2037-07-01', null, '12:00:00' ),
			),
		);
	}

	#[DataProvider( 'timings' )]
	public function test_timing_preserves_unknown_values( array $timing, array $expected ) {
		$this->assertSame(
			array(
				'timezone'  => 'Europe/Madrid',
				'allDay'    => $expected[0],
				'startDate' => $expected[1],
				'endDate'   => $expected[2],
				'startTime' => $expected[3],
				'endTime'   => $expected[4],
			),
			CampaignFacts::timing( $timing, 'Europe/Madrid' )
		);
	}

	public function test_inconsistent_timing_is_an_error() {
		$timing = array(
			'start_date' => '2037-07-03',
			'end_date'   => '2037-07-01',
			'start_time' => null,
			'end_time'   => null,
			'all_day'    => false,
		);

		$this->assertInstanceOf( WP_Error::class, CampaignFacts::timing( $timing, 'Europe/Madrid' ) );
		$this->assertInstanceOf( WP_Error::class, CampaignFacts::timing( array_merge( $timing, array( 'end_date' => null ) ), 'Europe/Madrid' ) );
		$this->assertInstanceOf( WP_Error::class, CampaignFacts::timing( array_merge( $timing, array( 'start_time' => '10:00' ) ), 'Europe/Madrid' ) );
		$this->assertInstanceOf(
			WP_Error::class,
			CampaignFacts::timing(
				array(
					'start_date' => null,
					'end_date'   => null,
					'start_time' => '10:00:00',
					'end_time'   => null,
					'all_day'    => false,
				),
				'Europe/Madrid'
			)
		);
	}

	public static function timezones() {
		return array(
			'named zone'      => array( 'Europe/Madrid', true ),
			'utc'             => array( 'UTC', true ),
			'positive offset' => array( '+05:30', true ),
			'negative offset' => array( '-03:00', true ),
			'empty'           => array( '', false ),
			'unknown zone'    => array( 'Mars/Olympus', false ),
			'wrong case'      => array( 'europe/madrid', false ),
			'bad offset'      => array( '+25:00', false ),
		);
	}

	#[DataProvider( 'timezones' )]
	public function test_timezone_must_resolve( $timezone, $valid ) {
		$result = CampaignFacts::timezone( $timezone );

		if ( $valid ) {
			$this->assertSame( $timezone, $result );
		} else {
			$this->assertInstanceOf( WP_Error::class, $result );
		}
	}

	public function test_unresolvable_site_timezone_prevents_the_read() {
		$this->event_date( 1 );
		$GLOBALS['_fair_test_timezone'] = '';

		$this->assertSame( 'fair_events_campaign_facts_invalid_timezone', CampaignFacts::read( 1 )->get_error_code() );
	}

	public static function coordinate_pairs() {
		return array(
			'valid pair'    => array( '39.4878023', '-0.3613204', array( 39.4878023, -0.3613204 ) ),
			'zero is valid' => array( '0', '0', array( 0.0, 0.0 ) ),
			'both blank'    => array( '', null, null ),
			'latitude only' => array( '39.48', null, null ),
			'not numeric'   => array( 'north', '-0.36', null ),
			'out of range'  => array( '91', '0', null ),
			'lng too far'   => array( '0', '-180.5', null ),
		);
	}

	#[DataProvider( 'coordinate_pairs' )]
	public function test_coordinates_need_a_complete_valid_pair( $latitude, $longitude, $expected ) {
		$result = CampaignFacts::coordinates( $latitude, $longitude );

		$this->assertSame(
			null === $expected ? null : array(
				'latitude'  => $expected[0],
				'longitude' => $expected[1],
			),
			$result
		);
	}

	public function test_venue_blank_fields_become_null_and_handle_loses_its_at() {
		$this->venue(
			7,
			array(
				'address'            => '  ',
				'website_url'        => '',
				'instagram_handle'   => '@hall',
				'facebook_page_link' => ' ',
			)
		);
		$venue = Venue::get_by_id_checked( 7 );

		$this->assertSame(
			array(
				'id'              => 'venue:7',
				'sourceId'        => 7,
				'name'            => 'Hall',
				'address'         => null,
				'coordinates'     => null,
				'websiteUrl'      => null,
				'instagramHandle' => 'hall',
				'facebookPageUrl' => null,
			),
			CampaignFacts::venue( $venue )
		);
	}

	public function test_venue_without_a_name_is_an_error() {
		$this->venue( 7, array( 'name' => ' ' ) );

		$this->assertInstanceOf( WP_Error::class, CampaignFacts::venue( Venue::get_by_id_checked( 7 ) ) );
	}
}
