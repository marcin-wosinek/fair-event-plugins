<?php
/**
 * CompleteCampaignFacts and SnapshotObjectCache unit tests (#2424): the
 * programme-item projection (resolved titles, standalone items,
 * bookability, broken references, invalid times), shifted local times, the
 * media registry, and the private cache used during a snapshot.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited
// phpcs:disable Squiz.Commenting.FunctionComment.Missing

use FairEvents\Models\ScheduleItem;
use FairEvents\Services\CompleteCampaignFacts;
use FairEvents\Services\SnapshotObjectCache;
use PHPUnit\Framework\TestCase;
use WP_Error;

/**
 * Tests for the pure parts of the complete campaign-facts read.
 */
class CompleteCampaignFactsTest extends TestCase {

	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	private function item( array $fields ) {
		$item = new ScheduleItem();
		foreach ( array_merge(
			array(
				'id'               => 41,
				'event_date_id'    => 7,
				'ticket_option_id' => null,
				'bookable'         => false,
				'title'            => 'Break',
				'start_datetime'   => '2037-03-04 18:00:00',
				'end_datetime'     => '2037-03-04 19:00:00',
				'description'      => '',
				'location'         => '',
				'sort_order'       => 0,
			),
			$fields
		) as $key => $value ) {
			$item->$key = $value;
		}
		return $item;
	}

	private function options() {
		return array( 9 => (object) array( 'name' => ' Acro (renamed) ' ) );
	}

	public function test_a_workshop_is_named_by_its_current_ticket_option_and_keeps_its_bookability() {
		$projected = CompleteCampaignFacts::schedule_item(
			$this->item(
				array(
					'ticket_option_id' => 9,
					'bookable'         => true,
					'title'            => '',
					'description'      => ' Bring water. ',
					'location'         => 'Studio A',
				)
			),
			$this->options()
		);

		$this->assertSame(
			array(
				'id'             => 'schedule-item:41',
				'sourceId'       => 41,
				'ticketOptionId' => 9,
				'title'          => 'Acro (renamed)',
				'description'    => 'Bring water.',
				'startsAtLocal'  => '2037-03-04T18:00:00',
				'endsAtLocal'    => '2037-03-04T19:00:00',
				'location'       => 'Studio A',
				'languages'      => null,
				'bookable'       => true,
			),
			$projected
		);
	}

	public function test_a_standalone_item_is_never_bookable_and_blank_text_is_null() {
		$projected = CompleteCampaignFacts::schedule_item(
			$this->item(
				array(
					'bookable' => true,
					'title'    => '  Social  ',
					'location' => '   ',
				)
			),
			array()
		);

		$this->assertSame( null, $projected['ticketOptionId'] );
		$this->assertSame( 'Social', $projected['title'] );
		$this->assertFalse( $projected['bookable'] );
		$this->assertNull( $projected['location'] );
		$this->assertNull( $projected['description'] );
	}

	public function test_a_missing_ticket_option_is_a_broken_reference() {
		$error = CompleteCampaignFacts::schedule_item( $this->item( array( 'ticket_option_id' => 5 ) ), $this->options() );

		$this->assertInstanceOf( WP_Error::class, $error );
		$this->assertSame( 'fair_events_schedule_ticket_option_missing', $error->get_error_code() );
		$this->assertSame( 500, $error->get_error_data()['status'] );
	}

	public function test_an_empty_title_is_unusable() {
		$error = CompleteCampaignFacts::schedule_item( $this->item( array( 'title' => '  ' ) ), array() );

		$this->assertSame( 'fair_events_campaign_facts_item_title_missing', $error->get_error_code() );
		$this->assertSame( 422, $error->get_error_data()['status'] );
	}

	public function test_an_end_not_after_the_start_or_a_malformed_time_is_unusable() {
		foreach ( array(
			array( 'end_datetime' => '2037-03-04 18:00:00' ),
			array( 'end_datetime' => '2037-03-04 17:00:00' ),
			array( 'start_datetime' => '2037-02-30 18:00:00' ),
			array( 'start_datetime' => 'soon' ),
		) as $fields ) {
			$error = CompleteCampaignFacts::schedule_item( $this->item( $fields ), array() );
			$this->assertSame( 'fair_events_campaign_facts_invalid_schedule_time', $error->get_error_code(), implode( ',', array_keys( $fields ) ) );
		}
	}

	public function test_local_times_are_shifted_in_the_site_timezone() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$this->assertSame( '2037-03-11T18:00:00', CompleteCampaignFacts::local_time( '2037-03-04 18:00:00', new \DateInterval( 'P7D' ) ) );
		// Across the spring change the wall-clock time stays the same.
		$this->assertSame( '2037-04-01T18:00:00', CompleteCampaignFacts::local_time( '2037-03-25 18:00:00', new \DateInterval( 'P7D' ) ) );
		$this->assertSame( '2037-03-04T18:00:00', CompleteCampaignFacts::local_time( '2037-03-04T18:00:00' ) );
		$this->assertNull( CompleteCampaignFacts::local_time( '2037-03-04' ) );
	}

	public function test_the_media_registry_holds_each_attachment_once_sorted_by_id() {
		$described = array(
			'url'    => 'https://example.org/a.png',
			'width'  => 400,
			'height' => 100,
			'alt'    => ' ',
			'credit' => null,
		);

		$registry = CompleteCampaignFacts::media_registry(
			array(
				60 => $described,
				52 => array_merge( $described, array( 'alt' => 'Dancers' ) ),
			),
			array(
				52 => $described,
				8  => array_merge(
					$described,
					array(
						'width'  => null,
						'height' => 50,
					)
				),
			)
		);

		$this->assertSame( array( 'media:8', 'media:52', 'media:60' ), wp_list_pluck( $registry, 'id' ) );
		$this->assertSame( 'Dancers', $registry[1]['altText'] );
		$this->assertNull( $registry[2]['altText'] );
		$this->assertNull( $registry[0]['width'] );
		$this->assertNull( $registry[0]['height'] );
	}

	public function test_a_media_entry_without_a_web_address_is_unusable() {
		$error = CompleteCampaignFacts::media_registry( array( 3 => array( 'url' => '/relative.png' ) ), array() );

		$this->assertSame( 'fair_events_campaign_facts_media_url_invalid', $error->get_error_code() );
	}

	public function test_the_snapshot_cache_is_private_and_returns_copies() {
		$cache = new SnapshotObjectCache();
		$post  = (object) array( 'post_title' => 'Original' );

		$this->assertTrue( $cache->add( 5, $post, 'posts' ) );
		$this->assertFalse( $cache->add( 5, $post, 'posts' ) );

		$read             = $cache->get( 5, 'posts', false, $found );
		$read->post_title = 'Changed';
		$this->assertTrue( $found );
		$this->assertSame( 'Original', $cache->get( 5, 'posts' )->post_title );

		$this->assertFalse( $cache->get( 5, 'default', false, $found ) );
		$this->assertFalse( $found );

		$this->assertFalse( $cache->replace( 6, 'x', 'posts' ) );
		$this->assertFalse( $cache->incr( 'n', 3, 'counts' ) );
		$cache->set( 'n', 1, 'counts' );
		$this->assertSame( 4, $cache->incr( 'n', 3, 'counts' ) );
		$this->assertSame( array( 5 => true ), $cache->delete_multiple( array( 5 ), 'posts' ) );
		$this->assertFalse( $cache->holds( 5, 'posts' ) );
		$this->assertFalse( $cache->some_drop_in_method() );
	}
}
