<?php
/**
 * Immediate engagement delivery tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\Outbox;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers the outbox reservation, the single bounded send and its stored outcome. */
class ImmediateEngagementTest extends TestCase {
	private const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

	/** @var mixed Original $wpdb. */
	private $original_wpdb;

	/** Install a $wpdb fake whose `event_id` is unique, like the real table's. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options']              = array(
			Conversions::DATASET_OPTION => '123456',
			Conversions::TOKEN_OPTION   => 'token-value',
		);
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_remote_post_response'] = array(
			'response' => array( 'code' => 200 ),
			'body'     => wp_json_encode(
				array(
					'events_received' => 1,
					'fbtrace_id'      => 'Trace1',
				)
			),
		);
		$this->original_wpdb                        = $GLOBALS['wpdb'] ?? null;
		$GLOBALS['wpdb']                            = new class() { // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test fake, restored in tearDown().
			/** @var string */
			public $prefix = 'wp_';
			/** @var array[] Inserted rows by event ID: `state`, `fbp`, `fbc` and all `args`. */
			public $rows = array();
			/** @var array[] Prepared UPDATE statements. */
			public $updates = array();

			/**
			 * @param string $query   Query.
			 * @param mixed  ...$args Arguments.
			 * @return array
			 */
			public function prepare( $query, ...$args ) {
				return array( $query, $args );
			}

			/**
			 * @param array $prepared Prepared query.
			 * @return int Affected rows.
			 */
			public function query( $prepared ) {
				list( $query, $args ) = $prepared;
				if ( 0 === strpos( $query, 'INSERT IGNORE' ) ) {
					// Arguments follow the column order after the table name.
					list( , , , , , $event_id, , , , , , , $fbp, $fbc, , $state ) = $args;
					if ( isset( $this->rows[ $event_id ] ) ) {
						return 0;
					}
					$this->rows[ $event_id ] = compact( 'state', 'fbp', 'fbc', 'args' );
					return 1;
				}
				$this->updates[] = $prepared;
				return 1;
			}
		};
	}

	/** Restore $wpdb. */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the original.
		unset( $GLOBALS['_fair_test_remote_post_response'] );
		parent::tearDown();
	}

	/**
	 * @param string $activation_id Activation UUID.
	 * @return array Engagement event.
	 */
	private function event( $activation_id = '3f2c8a4e-1b7d-4c9a-8e2f-0a1b2c3d4e5f' ) {
		return Conversions::build_engagement_event(
			'ticket',
			$activation_id,
			array(
				'post_id'       => 12,
				'event_date_id' => 34,
				'source_url'    => 'https://example.test/event',
			),
			'fb.1.1712345678901.browser',
			'',
			self::USER_AGENT
		);
	}

	/** @return array The prepared outcome UPDATE's arguments, by name. */
	private function stored_outcome() {
		$this->assertCount( 1, $GLOBALS['wpdb']->updates );
		list( $query, $args ) = $GLOBALS['wpdb']->updates[0];
		$this->assertStringContainsString( 'WHERE event_id = %s AND state = %s', $query );
		return array_combine( array( 'table', 'state', 'category', 'code', 'type', 'diagnostics', 'updated_at', 'event_id', 'from_state' ), $args );
	}

	/** One confirmed send: production payload, bounded timeout, stored as received with diagnostics. */
	public function test_confirmed_send_is_stored_as_received() {
		$event = $this->event();
		$this->assertTrue( ( new Conversions() )->deliver_engagement( $event ) );

		$requests = $GLOBALS['_fair_test_remote_post_requests'];
		$this->assertCount( 1, $requests );
		$this->assertSame( 10, Conversions::IMMEDIATE_TIMEOUT );
		$this->assertSame( Conversions::IMMEDIATE_TIMEOUT, $requests[0]['args']['timeout'] );
		$body = json_decode( $requests[0]['args']['body'], true );
		$this->assertArrayNotHasKey( 'test_event_code', $body );
		$this->assertSame( 'FairEventTicketClick', $body['data'][0]['event_name'] );
		$this->assertSame(
			array(
				'fbp'               => 'fb.1.1712345678901.browser',
				'client_user_agent' => self::USER_AGENT,
			),
			$body['data'][0]['user_data']
		);

		$outcome = $this->stored_outcome();
		$this->assertSame( 'immediate_received', $outcome['state'] );
		$this->assertSame( Outbox::IMMEDIATE_SENDING, $outcome['from_state'] );
		$this->assertSame( $event['event_id'], $outcome['event_id'] );
		$this->assertSame(
			array(
				'http_status'     => 200,
				'events_received' => 1,
				'messages'        => null,
				'fbtrace_id'      => 'Trace1',
			),
			json_decode( $outcome['diagnostics'], true )
		);
	}

	/** The reservation is never pending work and stores no browser identifiers or User-Agent. */
	public function test_reservation_is_not_queued_and_keeps_no_identifiers() {
		$event = $this->event();
		( new Conversions() )->deliver_engagement( $event );
		$row = $GLOBALS['wpdb']->rows[ $event['event_id'] ];
		$this->assertSame( Outbox::IMMEDIATE_SENDING, $row['state'] );
		$this->assertSame( '', $row['fbp'] );
		$this->assertSame( '', $row['fbc'] );
		$this->assertNotContains( self::USER_AGENT, $row['args'] );
		$outcome = $this->stored_outcome();
		$this->assertStringNotContainsString( 'fb.1.', (string) $outcome['diagnostics'] );
		$this->assertNotContains( self::USER_AGENT, $outcome );
	}

	/** A duplicate activation — also one already queued earlier — sends nothing. */
	public function test_duplicate_activation_sends_once() {
		$event = $this->event();
		( new Conversions() )->deliver_engagement( $event );
		$this->assertFalse( ( new Conversions() )->deliver_engagement( $event ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_remote_post_requests'] );

		$legacy = $this->event( '0b9f2d6e-5a4c-4e3b-9d2a-1c0b9a8f7e6d' );
		( new Outbox() )->enqueue( $legacy );
		$this->assertFalse( ( new Conversions() )->deliver_engagement( $legacy ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertSame( 'pending', $GLOBALS['wpdb']->rows[ $legacy['event_id'] ]['state'] );
	}

	/** Without credentials nothing is reserved or sent. */
	public function test_missing_configuration_sends_nothing() {
		$GLOBALS['_fair_test_options'] = array();
		$this->assertFalse( ( new Conversions() )->deliver_engagement( $this->event() ) );
		$this->assertSame( array(), $GLOBALS['wpdb']->rows );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/**
	 * @return array[] Meta answer => stored state.
	 */
	public static function failures() {
		return array(
			'unconfirmed' => array(
				array(
					'response' => array( 'code' => 200 ),
					'body'     => '{"events_received":0}',
				),
				'immediate_unconfirmed',
			),
			'rejected'    => array(
				array(
					'response' => array( 'code' => 400 ),
					'body'     => '{"error":{"code":100,"type":"OAuthException"}}',
				),
				'immediate_rejected',
			),
			'temporary'   => array(
				array(
					'response' => array( 'code' => 503 ),
					'body'     => '',
				),
				'immediate_temporary_error',
			),
			'transport'   => array( new \WP_Error( 'http_request_failed', 'timeout' ), 'immediate_transport' ),
		);
	}

	/**
	 * A failed send is stored once with its outcome and never retried.
	 *
	 * @param mixed  $response Meta answer.
	 * @param string $state    Expected stored state.
	 */
	#[DataProvider( 'failures' )]
	public function test_failure_is_stored_without_retry( $response, $state ) {
		$GLOBALS['_fair_test_remote_post_response'] = $response;
		$this->assertFalse( ( new Conversions() )->deliver_engagement( $this->event() ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertSame( $state, $this->stored_outcome()['state'] );
	}

	/** The queue worker only claims pending work, never an immediate row. */
	public function test_worker_claims_only_queued_states() {
		$GLOBALS['wpdb'] = new class() { // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test fake, restored in tearDown().
			/** @var string */
			public $prefix = 'wp_';
			/** @var string[] */
			public $queries = array();

			/**
			 * @param string $query   Query.
			 * @param mixed  ...$args Arguments.
			 * @return string
			 */
			public function prepare( $query, ...$args ) {
				unset( $args );
				$this->queries[] = $query;
				return $query;
			}

			/**
			 * @param string $query Query.
			 * @return null
			 */
			public function get_var( $query ) {
				unset( $query );
				return null;
			}
		};
		( new Outbox() )->claim_due();
		$this->assertStringContainsString( "state IN ('pending','retry_pending')", $GLOBALS['wpdb']->queries[0] );
	}
}
