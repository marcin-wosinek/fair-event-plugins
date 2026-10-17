<?php
/**
 * Meta button-click engagement tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\Engagement;
use PHPUnit\Framework\TestCase;

/** Covers engagement payload privacy, replay identity and the per-IP limit. */
class EngagementTest extends TestCase {
	private const ACTIVATION = '3f2c8a4e-1b7d-4c9a-8e2f-0a1b2c3d4e5f';
	private const FBP        = 'fb.1.1712345678901.browser';

	/** Reset the fake transient store before each test. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_transients']           = array();
		$GLOBALS['_fair_test_options']              = array();
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_remote_post_response'] = array(
			'response' => array( 'code' => 200 ),
			'body'     => '{"events_received":1,"messages":[],"fbtrace_id":"T"}',
		);
	}

	/**
	 * Validated event context, as Engagement::event_context() returns it.
	 *
	 * @return array
	 */
	private function context() {
		return array(
			'post_id'       => 12,
			'event_date_id' => 34,
			'source_url'    => 'https://example.test/fair-events/mix-and-move/',
		);
	}

	/** Each action maps to its own custom event, distinct from commerce events. */
	public function test_actions_map_to_distinct_custom_events() {
		$calendar = Conversions::build_engagement_event( 'calendar', self::ACTIVATION, $this->context(), self::FBP, '' );
		$ticket   = Conversions::build_engagement_event( 'ticket', '9f2c8a4e-1b7d-4c9a-8e2f-0a1b2c3d4e5f', $this->context(), self::FBP, '' );
		$this->assertSame( 'FairEventCalendarClick', $calendar['event_name'] );
		$this->assertSame( 'FairEventTicketClick', $ticket['event_name'] );
		$this->assertNotContains( 'InitiateCheckout', Conversions::ENGAGEMENT_EVENTS );
		$this->assertNotContains( 'Purchase', Conversions::ENGAGEMENT_EVENTS );
	}

	/** The queued row carries event context but no transaction or commerce data. */
	public function test_engagement_event_has_context_and_no_commerce_data() {
		$event = Conversions::build_engagement_event( 'ticket', self::ACTIVATION, $this->context(), self::FBP, 'invalid' );
		$this->assertArrayNotHasKey( 'transaction_id', $event );
		$this->assertSame( 12, $event['event_post_id'] );
		$this->assertSame( 34, $event['event_date_id'] );
		$this->assertSame( 'https://example.test/fair-events/mix-and-move/', $event['source_url'] );
		$this->assertSame( '', $event['currency'] );
		$this->assertSame( '', $event['order_id'] );
		$this->assertSame( '', $event['payment_mode'] );
		$this->assertSame( self::FBP, $event['fbp'] );
		$this->assertSame( '', $event['fbc'], 'An invalid identifier is dropped.' );
	}

	/** Unknown actions, malformed activation IDs and missing identifiers fail closed. */
	public function test_build_engagement_event_rejects_invalid_input() {
		$this->assertNull( Conversions::build_engagement_event( 'purchase', self::ACTIVATION, $this->context(), self::FBP, '' ) );
		$this->assertNull( Conversions::build_engagement_event( 'ticket', 'not-a-uuid', $this->context(), self::FBP, '' ) );
		$this->assertNull( Conversions::build_engagement_event( 'ticket', '3f2c8a4e-1b7d-1c9a-8e2f-0a1b2c3d4e5f', $this->context(), self::FBP, '' ) );
		$this->assertNull( Conversions::build_engagement_event( 'ticket', self::ACTIVATION, $this->context(), '', '' ) );
		$this->assertNull( Conversions::build_engagement_event( 'ticket', self::ACTIVATION, $this->context(), 'invalid', 'invalid' ) );
	}

	/** A replayed activation keeps its event ID, whatever action it claims; new activations differ. */
	public function test_event_id_identifies_the_activation() {
		$first  = Conversions::build_engagement_event( 'ticket', self::ACTIVATION, $this->context(), self::FBP, '' );
		$replay = Conversions::build_engagement_event( 'calendar', strtoupper( self::ACTIVATION ), $this->context(), self::FBP, '' );
		$next   = Conversions::build_engagement_event( 'ticket', '9f2c8a4e-1b7d-4c9a-8e2f-0a1b2c3d4e5f', $this->context(), self::FBP, '' );
		$this->assertSame( $first['event_id'], $replay['event_id'] );
		$this->assertNotSame( $first['event_id'], $next['event_id'] );
		$this->assertNotSame( $first['event_id'], Conversions::event_id( 12, 'FairEventTicketClick' ) );
	}

	/** The Meta payload holds the event context and identifiers only. */
	public function test_engagement_payload_omits_commerce_and_destination_data() {
		$row     = (object) array(
			'event_name'    => 'FairEventTicketClick',
			'event_time'    => 123,
			'event_id'      => 'stable',
			'source_url'    => 'https://example.test/fair-events/mix-and-move/',
			'event_post_id' => '12',
			'event_date_id' => '34',
			'fbp'           => self::FBP,
			'fbc'           => '',
			'value'         => '0.00',
			'currency'      => '',
			'order_id'      => '',
			'payment_mode'  => '',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( 'FairEventTicketClick', $payload['event_name'] );
		$this->assertSame( array( 'fbp' => self::FBP ), $payload['user_data'] );
		$this->assertSame(
			array(
				'post_id'       => 12,
				'event_date_id' => 34,
				'action'        => 'ticket',
			),
			$payload['custom_data']
		);
		$this->assertSame( 'https://example.test/fair-events/mix-and-move/', $payload['event_source_url'] );
	}

	/** Commerce payloads keep their shape next to engagement events. */
	public function test_commerce_payload_is_unchanged() {
		$row     = (object) array(
			'event_name'   => 'InitiateCheckout',
			'event_time'   => 123,
			'event_id'     => 'stable',
			'source_url'   => 'https://example.test/event',
			'fbp'          => self::FBP,
			'fbc'          => '',
			'value'        => '25.00',
			'currency'     => 'EUR',
			'order_id'     => '',
			'payment_mode' => 'live',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame(
			array(
				'value'        => 25.0,
				'currency'     => 'EUR',
				'payment_mode' => 'live',
			),
			$payload['custom_data']
		);
	}

	/** Each address gets RATE_LIMIT attempts per window. */
	public function test_rate_limit_per_address() {
		for ( $i = 0; $i < Engagement::RATE_LIMIT; $i++ ) {
			$this->assertTrue( Engagement::allow( '203.0.113.5' ) );
		}
		$this->assertFalse( Engagement::allow( '203.0.113.5' ) );
		$this->assertTrue( Engagement::allow( '203.0.113.6' ), 'Another address has its own counter.' );
		$stored = $GLOBALS['_fair_test_transients'][ 'fair_events_experimental_meta_engagement_' . md5( '203.0.113.5' ) ];
		$this->assertSame( Engagement::RATE_LIMIT, $stored['value'] );
		$this->assertSame( Engagement::RATE_WINDOW, $stored['expiration'] );
	}

	/** The calendar test payload is the production calendar payload with a fresh ID and no commerce data. */
	public function test_calendar_test_uses_the_production_engagement_payload() {
		$payload    = Conversions::build_engagement_test_event(
			array(
				'context' => $this->context(),
				'fbp'     => self::FBP,
				'fbc'     => '',
			)
		);
		$production = Conversions::payload_for( (object) Conversions::build_engagement_event( 'calendar', self::ACTIVATION, $this->context(), self::FBP, '' ) );
		$this->assertSame( 'FairEventCalendarClick', $payload['event_name'] );
		$this->assertSame( array_keys( $production ), array_keys( $payload ) );
		$this->assertSame( $production['custom_data'], $payload['custom_data'] );
		$this->assertSame( $production['user_data'], $payload['user_data'] );
		$this->assertSame( 'https://example.test/fair-events/mix-and-move/', $payload['event_source_url'] );
		$this->assertNotSame( $production['event_id'], $payload['event_id'], 'A test gets its own activation ID.' );
		$this->assertArrayNotHasKey( 'value', $payload['custom_data'] );
		$this->assertArrayNotHasKey( 'currency', $payload['custom_data'] );
		$this->assertArrayNotHasKey( 'order_id', $payload['custom_data'] );
	}

	/** Without context or a valid identifier there is no calendar test payload. */
	public function test_calendar_test_requires_context_and_identifier() {
		$this->assertNull( Conversions::build_engagement_test_event( null ) );
		$this->assertNull( Conversions::build_engagement_test_event( array( 'fbp' => self::FBP ) ) );
		$this->assertNull(
			Conversions::build_engagement_test_event(
				array(
					'context' => $this->context(),
					'fbp'     => 'invalid',
				)
			)
		);
	}

	/** The calendar test is sent with the test code and recorded; routine delivery stays free of it. */
	public function test_calendar_test_is_sent_with_the_test_code_only() {
		update_option( Conversions::DATASET_OPTION, '123456' );
		update_option( Conversions::TOKEN_OPTION, 'token-value' );
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$conversions = new Conversions();
		$result      = $conversions->send_test(
			'FairEventCalendarClick',
			array(
				'context' => $this->context(),
				'fbp'     => self::FBP,
				'fbc'     => '',
			)
		);
		$this->assertTrue( $result['accepted'] );
		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertSame( 'CODE123', $body['test_event_code'] );
		$this->assertSame( 'FairEventCalendarClick', $body['data'][0]['event_name'] );
		$this->assertSame( 'calendar', $body['data'][0]['custom_data']['action'] );
		$this->assertSame( 'FairEventCalendarClick', Conversions::test_history()[0]['event_name'] );

		$routine = Conversions::build_engagement_event( 'calendar', self::ACTIVATION, $this->context(), self::FBP, '' );
		$conversions->send_payload( Conversions::payload_for( (object) $routine ) );
		$routine_body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][1]['args']['body'], true );
		$this->assertArrayNotHasKey( 'test_event_code', $routine_body );
	}

	/** An invalid calendar test context fails before any network call and is not recorded. */
	public function test_calendar_test_without_context_fails_closed() {
		update_option( Conversions::DATASET_OPTION, '123456' );
		update_option( Conversions::TOKEN_OPTION, 'token-value' );
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$result = ( new Conversions() )->send_test( 'FairEventCalendarClick', null );
		$this->assertFalse( $result['accepted'] );
		$this->assertSame( 'invalid_test_context', $result['code'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertSame( array(), Conversions::test_history() );
	}
}
