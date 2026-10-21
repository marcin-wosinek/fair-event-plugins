<?php
/**
 * Meta sent-request log tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use FairEventsExperimental\Meta\DeliveryAttempts;
use FairEventsExperimental\Meta\RequestDiagnostics;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers how each request to Meta is logged with its answer. */
class DeliveryAttemptsTest extends TestCase {
	private const FBP        = 'fb.1.1712345678901.browser';
	private const USER_AGENT = 'Mozilla/5.0 AttemptsTest';

	/** @var mixed Original $wpdb. */
	private $original_wpdb;

	/** Install a $wpdb fake that records attempt writes and serves due outbox rows. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options']              = array(
			Conversions::DATASET_OPTION   => '123456',
			Conversions::TOKEN_OPTION     => 'token-value',
			Conversions::TEST_CODE_OPTION => 'TEST12345',
		);
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_scheduled']            = array();
		$this->meta_answers( 200, array( 'events_received' => 1 ) );
		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
		$GLOBALS['wpdb']     = new class() { // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test fake, restored in tearDown().
			/** @var string */
			public $prefix = 'wp_';
			/** @var int */
			public $insert_id = 0;
			/** @var array[] Rows inserted per table. */
			public $inserted = array();
			/** @var array[] `[ table, data, where ]` per update. */
			public $updated = array();
			/** @var array[] Prepared queries run. */
			public $queries = array();
			/** @var int[] Sent requests counted at each attempt insert. */
			public $sent_at_insert = array();
			/** @var string|null 'throw' or 'false' to fail attempt inserts. */
			public $fail_insert = null;
			/** @var object[] Outbox rows claim_due() hands out. */
			public $due = array();

			/** @param string $query Query. @param mixed ...$args Arguments. @return array */
			public function prepare( $query, ...$args ) {
				return array( $query, $args );
			}

			/**
			 * @param string $table Table.
			 * @param array  $data  Data.
			 * @return int|false
			 * @throws \RuntimeException When told to fail by throwing.
			 */
			public function insert( $table, $data ) {
				if ( 'throw' === $this->fail_insert ) {
					throw new \RuntimeException( 'database gone' );
				}
				if ( 'false' === $this->fail_insert ) {
					return false;
				}
				$this->sent_at_insert[]     = count( $GLOBALS['_fair_test_remote_post_requests'] );
				$this->inserted[ $table ][] = $data;
				++$this->insert_id;
				return 1;
			}

			/** @param string $table Table. @param array $data Data. @param array $where Where. @return int */
			public function update( $table, $data, $where ) {
				$this->updated[] = array( $table, $data, $where );
				return 1;
			}

			/** @param array $prepared Prepared query. @return int */
			public function query( $prepared ) {
				$this->queries[] = $prepared;
				return 1;
			}

			/** @param array $prepared Prepared query. @return mixed */
			public function get_var( $prepared ) {
				$this->queries[] = $prepared;
				return false !== strpos( $prepared[0], "state IN ('pending','retry_pending')" ) && $this->due ? $this->due[0]->id : null;
			}

			/** @param array $prepared Prepared query. @return object|null */
			public function get_row( $prepared ) {
				$this->queries[] = $prepared;
				return array_shift( $this->due );
			}

			/** @return array */
			public function get_results() {
				return array();
			}
		};
	}

	/** Restore $wpdb. */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the original.
		unset( $GLOBALS['_fair_test_remote_post_response'] );
		parent::tearDown();
	}

	/** @param int $status HTTP status. @param array $body Body. */
	private function meta_answers( $status, $body ) {
		$GLOBALS['_fair_test_remote_post_response'] = array(
			'response' => array( 'code' => $status ),
			'body'     => wp_json_encode( $body ),
		);
	}

	/** @return array[] Attempt rows inserted so far. */
	private function attempts() {
		return $GLOBALS['wpdb']->inserted[ DeliveryAttempts::table_name() ] ?? array();
	}

	/** @return array[] Attempt updates so far. */
	private function attempt_updates() {
		return array_values( array_filter( $GLOBALS['wpdb']->updated, static fn( $update ) => DeliveryAttempts::table_name() === $update[0] ) );
	}

	/** @return array A production engagement payload. */
	private function event() {
		$row = Conversions::build_engagement_event(
			'ticket',
			'3f2c8a4e-1b7d-4c9a-8e2f-0a1b2c3d4e5f',
			array(
				'post_id'       => 12,
				'event_date_id' => 34,
				'source_url'    => 'https://example.test/event',
			),
			self::FBP,
			'',
			self::USER_AGENT
		);
		return Conversions::payload_for( (object) $row );
	}

	/**
	 * @param array  $body Decoded body.
	 * @param string $path Snapshot path such as `data[0].user_data.fbp`.
	 * @return mixed The value at the path.
	 */
	private function at_path( $body, $path ) {
		foreach ( preg_split( '/\.|(?=\[)/', $path ) as $part ) {
			$key  = preg_match( '/^\[(\d+)\]$/', $part, $match ) ? (int) $match[1] : $part;
			$body = $body[ $key ];
		}
		return $body;
	}

	/** The snapshot lists exactly what was sent, with safe values intact. */
	public function test_snapshot_matches_the_sent_request() {
		$result = ( new Conversions() )->send_payload( $this->event() );
		$sent   = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertSame( 'https://graph.facebook.com/' . Conversions::GRAPH_API_VERSION . '/123456/events', $GLOBALS['_fair_test_remote_post_requests'][0]['url'] );
		$this->assertSame( '123456', $result['request']['dataset_id'] );
		$this->assertSame( Conversions::GRAPH_API_VERSION, $result['request']['api_version'] );
		$this->assertFalse( $result['request']['test_events_code'] );
		$types = array(
			'string'  => 'is_string',
			'integer' => 'is_int',
			'number'  => 'is_float',
			'object'  => 'is_array',
			'array'   => 'is_array',
		);
		foreach ( $result['request']['fields'] as $field ) {
			$value = $this->at_path( $sent, $field['path'] );
			$this->assertTrue( $types[ $field['type'] ]( $value ), $field['path'] );
			if ( 'value' === $field['state'] ) {
				$this->assertSame( $value, $field['value'], $field['path'] );
			}
			if ( isset( $field['count'] ) ) {
				$this->assertCount( $field['count'], $value, $field['path'] );
			}
		}
		$listed = array_column( $result['request']['fields'], 'path' );
		$this->assertContains( 'access_token', $listed );
		$this->assertContains( 'data[0].user_data.client_user_agent', $listed );
		$this->assertContains( 'data[0].custom_data.action', $listed );
		$json = wp_json_encode( $result['request'] );
		foreach ( array( 'token-value', self::FBP, self::USER_AGENT, $sent['data'][0]['event_id'] ) as $secret ) {
			$this->assertStringNotContainsString( $secret, $json );
		}
	}

	/** The attempt is logged before the send and paired with Meta's answer after it. */
	public function test_attempt_is_logged_before_sending_and_finished_with_the_answer() {
		$this->meta_answers(
			200,
			array(
				'events_received' => 1,
				'fbtrace_id'      => 'Trace1',
			)
		);
		( new Conversions() )->send_payload(
			$this->event(),
			'',
			Conversions::IMMEDIATE_TIMEOUT,
			array(
				'origin'        => 'production',
				'delivery_path' => 'immediate',
			)
		);
		$this->assertSame( array( 0 ), $GLOBALS['wpdb']->sent_at_insert );
		$attempt = $this->attempts()[0];
		$this->assertSame( 'production', $attempt['origin'] );
		$this->assertSame( 'immediate', $attempt['delivery_path'] );
		$this->assertSame( 'FairEventTicketClick', $attempt['event_name'] );
		$this->assertSame( 1, $attempt['attempt_number'] );
		$this->assertSame( 0, $attempt['test_events'] );
		$this->assertSame( '', $attempt['payment_mode'] );
		$this->assertSame( 1, json_decode( $attempt['request'], true )['version'] );
		$updates = $this->attempt_updates();
		$this->assertCount( 1, $updates );
		$this->assertSame( array( 'id' => 1 ), $updates[0][2] );
		$this->assertSame( 'received', $updates[0][1]['outcome'] );
		$this->assertSame(
			array(
				'http_status'     => 200,
				'events_received' => 1,
				'messages'        => null,
				'fbtrace_id'      => 'Trace1',
			),
			json_decode( $updates[0][1]['response'], true )
		);
	}

	/** Administrator tests are logged as such, with Test Events routing, and recorded in history as logged. */
	public function test_administrator_test_is_logged_with_test_events_routing() {
		$result = ( new Conversions() )->send_test( 'Purchase' );
		$this->assertTrue( $result['request']['test_events_code'] );
		$attempt = $this->attempts()[0];
		$this->assertSame( 'admin_test', $attempt['origin'] );
		$this->assertSame( 'test', $attempt['delivery_path'] );
		$this->assertSame( 1, $attempt['test_events'] );
		$this->assertStringNotContainsString( 'TEST12345', $attempt['request'] );
		$this->assertTrue( Conversions::test_history()[0]['request_logged'] );
	}

	/** A request that never reached Meta keeps its snapshot and records no answer. */
	public function test_transport_failure_keeps_the_request() {
		$GLOBALS['_fair_test_remote_post_response'] = new \WP_Error( 'http_request_failed', 'timeout' );
		$result                                     = ( new Conversions() )->send_payload( $this->event() );
		$this->assertSame( 'transport', $result['outcome'] );
		$this->assertNotEmpty( $result['request']['fields'] );
		$update = $this->attempt_updates()[0][1];
		$this->assertSame( 'transport', $update['outcome'] );
		$this->assertNull( json_decode( $update['response'], true )['http_status'] );
	}

	/** Nothing is logged, and no request is reported, when nothing was sent. */
	public function test_configuration_failure_sends_and_logs_nothing() {
		unset( $GLOBALS['_fair_test_options'][ Conversions::DATASET_OPTION ] );
		$result = ( new Conversions() )->send_payload( $this->event() );
		$this->assertSame( 'configuration', $result['outcome'] );
		$this->assertNull( $result['request'] );
		$this->assertSame( array(), $this->attempts() );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/** Every queued retry is its own attempt, linked to its outbox row and numbered. */
	public function test_queued_retries_are_logged_per_attempt() {
		$this->meta_answers( 503, array( 'error' => array( 'message' => 'Busy' ) ) );
		$row                  = (object) array(
			'id'                => 77,
			'event_name'        => 'Purchase',
			'event_time'        => 123,
			'event_id'          => hash( 'sha256', 'row' ),
			'source_url'        => 'https://example.test/event',
			'value'             => '12.50',
			'currency'          => 'EUR',
			'order_id'          => '42',
			'payment_mode'      => 'live',
			'fbp'               => self::FBP,
			'fbc'               => '',
			'event_context'     => null,
			'attempt_count'     => 2,
			'event_post_id'     => null,
			'event_date_id'     => null,
			'client_user_agent' => '',
		);
		$GLOBALS['wpdb']->due = array( $row );
		( new Conversions() )->deliver_due();
		$attempt = $this->attempts()[0];
		$this->assertSame( 77, $attempt['outbox_id'] );
		$this->assertSame( 'queued', $attempt['delivery_path'] );
		$this->assertSame( 3, $attempt['attempt_number'] );
		$this->assertSame( 'live', $attempt['payment_mode'] );
		$this->assertSame( 'temporary_error', $this->attempt_updates()[0][1]['outcome'] );
		// The outbox row is still scheduled for its next retry as before.
		$outbox = array_values( array_filter( $GLOBALS['wpdb']->updated, static fn( $update ) => DeliveryAttempts::table_name() !== $update[0] ) );
		$this->assertSame( 'retry_pending', $outbox[0][1]['state'] );
		$this->assertSame( 3, $outbox[0][1]['attempt_count'] );
	}

	/**
	 * A failing log neither stops the send nor changes its classification.
	 *
	 * @param string $failure How the attempt insert fails.
	 */
	#[\PHPUnit\Framework\Attributes\TestWith( array( 'throw' ) )]
	#[\PHPUnit\Framework\Attributes\TestWith( array( 'false' ) )]
	public function test_logging_failure_does_not_affect_delivery( $failure ) {
		$GLOBALS['wpdb']->fail_insert = $failure;
		$this->meta_answers( 400, array( 'error' => array( 'code' => 100 ) ) );
		$result = ( new Conversions() )->send_payload( $this->event() );
		$this->assertCount( 1, $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertSame( 'rejected', $result['outcome'] );
		$this->assertSame( '100', $result['code'] );
		$this->assertSame( 0, $result['attempt_id'] );
		$this->assertSame( array(), $this->attempt_updates() );
		( new Conversions() )->send_test( 'PageView' );
		$this->assertFalse( Conversions::test_history()[0]['request_logged'] );
	}

	/** Meta's messages never echo the identifiers that were sent. */
	public function test_echoed_identifiers_are_redacted_from_messages() {
		$event = $this->event();
		$this->meta_answers(
			400,
			array(
				'error' => array(
					'message' => 'Bad event ' . $event['event_id'] . ' from ' . self::USER_AGENT . ' hash ' . hash( 'sha256', 'x' ),
				),
			)
		);
		$result = ( new Conversions() )->send_payload( $event );
		$this->assertSame( array( 'Bad event [redacted] from [redacted] hash [redacted]' ), $result['diagnostics']['messages'] );
		$this->assertStringNotContainsString( self::USER_AGENT, $this->attempt_updates()[0][1]['response'] );
	}

	/** Writes prune expired attempts and keep at most the newest {@see DeliveryAttempts::MAX_ATTEMPTS}. */
	public function test_writes_prune_by_age_and_count() {
		( new Conversions() )->send_payload( $this->event() );
		list( $by_age, $newest ) = $GLOBALS['wpdb']->queries;
		$this->assertStringContainsString( 'DELETE FROM %i WHERE created_at < %s', $by_age[0] );
		$this->assertSame( gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS ), $by_age[1][1] );
		$this->assertStringContainsString( 'ORDER BY id DESC LIMIT 1 OFFSET %d', $newest[0] );
		$this->assertSame( DeliveryAttempts::MAX_ATTEMPTS - 1, $newest[1][1] );
	}

	/** Reads exclude expired attempts and apply the filters. */
	public function test_query_excludes_expired_attempts() {
		( new DeliveryAttempts() )->query(
			array(
				'page'       => 2,
				'per_page'   => 10,
				'origin'     => 'admin_test',
				'event_name' => 'Purchase',
			)
		);
		list( $query, $args ) = $GLOBALS['wpdb']->queries[0];
		$this->assertStringContainsString( 'created_at >= %s AND origin = %s AND event_name = %s', $query );
		$this->assertSame( array( DeliveryAttempts::table_name(), gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS ), 'admin_test', 'Purchase' ), $args );
	}

	/** Unfinished and legacy-shaped rows are presented honestly, with only validated fields. */
	public function test_present_reports_unavailable_results() {
		$row       = array(
			'id'             => '5',
			'outbox_id'      => null,
			'origin'         => 'production',
			'delivery_path'  => 'immediate',
			'event_name'     => 'FairEventCalendarClick',
			'attempt_number' => '1',
			'payment_mode'   => '',
			'test_events'    => '0',
			'request'        => null,
			'outcome'        => '',
			'result_code'    => '',
			'result_type'    => '',
			'response'       => null,
			'created_at'     => '2026-01-01 00:00:00',
			'finished_at'    => null,
		);
		$presented = DeliveryAttempts::present( $row );
		$this->assertNull( $presented['outcome'] );
		$this->assertNull( $presented['request'] );
		$this->assertNull( $presented['response'] );
		$this->assertSame( 5, $presented['id'] );
		$this->assertFalse( $presented['test_events'] );
		$this->assertArrayNotHasKey( 'outbox_id', $presented );

		$row['request']  = wp_json_encode( RequestDiagnostics::capture( array( 'data' => array( $this->event() ) ), '1', 'v26.0' ) );
		$row['response'] = wp_json_encode(
			array(
				'http_status' => 200,
				'messages'    => array( 'ok', array( 'nested' ) ),
				'raw_body'    => 'secret',
			)
		);
		$presented       = DeliveryAttempts::present( $row );
		$this->assertSame( array( 'ok' ), $presented['response']['messages'] );
		$this->assertArrayNotHasKey( 'raw_body', $presented['response'] );
		$this->assertSame( 1, $presented['request']['version'] );
	}
}
