<?php
/**
 * Meta conversion payload tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use PHPUnit\Framework\TestCase;

/** Covers privacy-sensitive pure conversion transformations. */
class ConversionsTest extends TestCase {
	/** Reset the fake options store and captured HTTP requests before each test. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options']              = array();
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		$GLOBALS['_fair_test_remote_post_response'] = $this->meta_response( 200, array( 'events_received' => 1 ) );
	}

	/**
	 * A simulated Meta answer.
	 *
	 * @param int          $status HTTP status.
	 * @param array|string $body   Body, JSON-encoded unless already a string.
	 * @return array
	 */
	private function meta_response( $status, $body ) {
		return array(
			'response' => array( 'code' => $status ),
			'body'     => is_string( $body ) ? $body : wp_json_encode( $body ),
		);
	}

	/**
	 * Build a minimal event payload as send_payload() expects.
	 *
	 * @return array
	 */
	private function sample_event() {
		return array(
			'event_name'       => 'Purchase',
			'event_time'       => 123,
			'event_id'         => 'stable',
			'action_source'    => 'website',
			'event_source_url' => 'https://example.test/event',
			'user_data'        => array( 'fbp' => 'fb.1.1712345678901.browser' ),
			'custom_data'      => array(
				'value'        => 12.5,
				'currency'     => 'EUR',
				'payment_mode' => 'test',
			),
		);
	}

	/** Configure a dataset ID and access token so send_payload() proceeds to the network call. */
	private function configure_credentials() {
		update_option( Conversions::DATASET_OPTION, '123456' );
		update_option( Conversions::TOKEN_OPTION, 'token-value' );
	}

	/** Identifier validation fails closed. */
	public function test_identifier_validation() {
		$this->assertTrue( Conversions::valid_identifier( 'fb.1.1712345678901.click_ABC-2' ) );
		$this->assertFalse( Conversions::valid_identifier( 'not-a-meta-id' ) );
	}

	/** Logical lifecycle events get stable, distinct IDs. */
	public function test_event_ids_are_deterministic_and_distinct() {
		$this->assertSame( Conversions::event_id( 42, 'Purchase' ), Conversions::event_id( 42, 'Purchase' ) );
		$this->assertNotSame( Conversions::event_id( 42, 'Purchase' ), Conversions::event_id( 42, 'InitiateCheckout' ) );
	}

	/** Payload contains only the approved matching and commerce fields. */
	public function test_payload_omits_unapproved_customer_data() {
		$row     = (object) array(
			'event_name'   => 'Purchase',
			'event_time'   => 123,
			'event_id'     => 'stable',
			'source_url'   => 'https://example.test/event',
			'fbp'          => 'fb.1.1712345678901.browser',
			'fbc'          => '',
			'value'        => '12.50',
			'currency'     => 'EUR',
			'order_id'     => '77',
			'payment_mode' => 'live',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( array( 'fbp' => $row->fbp ), $payload['user_data'] );
		$this->assertSame( '77', $payload['custom_data']['order_id'] );
		$this->assertArrayNotHasKey( 'email', $payload['user_data'] );
		$this->assertArrayNotHasKey( 'client_ip_address', $payload['user_data'] );
	}

	/** The delivered custom_data always names which payment mode produced the sale. */
	public function test_payload_includes_payment_mode() {
		$row     = (object) array(
			'event_name'   => 'Purchase',
			'event_time'   => 123,
			'event_id'     => 'stable',
			'source_url'   => '',
			'fbp'          => 'fb.1.1712345678901.browser',
			'fbc'          => '',
			'value'        => '12.50',
			'currency'     => 'EUR',
			'order_id'     => '77',
			'payment_mode' => 'test',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( 'test', $payload['custom_data']['payment_mode'] );
	}

	/**
	 * Build a transaction fixture that passes every eligibility check.
	 *
	 * @param array $overrides Fields to override on the base fixture.
	 * @return object
	 */
	private function eligible_transaction( array $overrides = array() ) {
		$defaults = array(
			'id'                   => 42,
			'amount'               => '12.50',
			'currency'             => 'eur',
			'testmode'             => 1,
			'status'               => 'paid',
			'updated_at'           => '2026-01-01 10:00:00',
			'payment_initiated_at' => '2026-01-01 09:59:00',
			'metadata'             => wp_json_encode(
				array(
					'source'          => 'fair-events-get-tickets',
					'meta_consent'    => true,
					'meta_fbp'        => 'fb.1.1712345678901.click_ABC-2',
					'meta_fbc'        => '',
					'meta_source_url' => 'https://example.test/event',
				)
			),
		);
		return (object) array_merge( $defaults, $overrides );
	}

	/** A payment-mode-eligible transaction stays eligible in both modes and carries its own mode. */
	public function test_build_event_reports_both_payment_modes() {
		$test_event = Conversions::build_event( $this->eligible_transaction( array( 'testmode' => 1 ) ), 'Purchase' );
		$live_event = Conversions::build_event( $this->eligible_transaction( array( 'testmode' => 0 ) ), 'Purchase' );
		$this->assertIsArray( $test_event );
		$this->assertIsArray( $live_event );
		$this->assertSame( 'test', $test_event['payment_mode'] );
		$this->assertSame( 'live', $live_event['payment_mode'] );
	}

	/** Without current marketing consent, no event is built regardless of payment mode. */
	public function test_build_event_rejects_missing_consent() {
		$transaction = $this->eligible_transaction(
			array(
				'metadata' => wp_json_encode(
					array(
						'source'   => 'fair-events-get-tickets',
						'meta_fbp' => 'fb.1.1712345678901.click_ABC-2',
					)
				),
			)
		);
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase' ) );
	}

	/** Without a valid Meta browser identifier, no event is built. */
	public function test_build_event_rejects_missing_browser_identifier() {
		$transaction = $this->eligible_transaction(
			array(
				'metadata' => wp_json_encode(
					array(
						'source'       => 'fair-events-get-tickets',
						'meta_consent' => true,
						'meta_fbp'     => 'not-a-meta-id',
						'meta_fbc'     => '',
					)
				),
			)
		);
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase' ) );
	}

	/** Only the unified checkout's transactions are eligible. */
	public function test_build_event_rejects_other_sources() {
		$transaction = $this->eligible_transaction( array( 'metadata' => wp_json_encode( array( 'source' => 'some-other-plugin' ) ) ) );
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase' ) );
	}

	/**
	 * A resolved event context, as PurchaseContext returns it.
	 *
	 * @return array
	 */
	private function event_context() {
		return array(
			'content_name'     => 'Mix & Move',
			'content_ids'      => array( '12' ),
			'event_date_id'    => 31,
			'event_start_date' => '2026-11-12',
		);
	}

	/** Checkout and purchase rows snapshot the context and keep every commerce field. */
	public function test_build_event_snapshots_context_with_commerce_fields() {
		foreach ( array( 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$plain = Conversions::build_event( $this->eligible_transaction(), $event_name );
			$event = Conversions::build_event( $this->eligible_transaction(), $event_name, $this->event_context() );
			$this->assertSame( '', $plain['event_context'] );
			$this->assertSame( $this->event_context(), json_decode( $event['event_context'], true ) );
			unset( $plain['event_context'], $event['event_context'] );
			$this->assertSame( $plain, $event );
		}
	}

	/** Malformed resolved context is reduced to its valid fields before it is stored. */
	public function test_build_event_normalizes_context() {
		$event = Conversions::build_event(
			$this->eligible_transaction(),
			'Purchase',
			array(
				'content_ids'      => array( '12' ),
				'event_start_date' => 'soon',
				'email'            => 'buyer@example.test',
			)
		);
		$this->assertSame( '{"content_ids":["12"]}', $event['event_context'] );
	}

	/** Context never makes an ineligible transaction eligible. */
	public function test_build_event_with_context_still_requires_consent() {
		$transaction = $this->eligible_transaction( array( 'metadata' => wp_json_encode( array( 'source' => 'fair-events-get-tickets' ) ) ) );
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase', $this->event_context() ) );
	}

	/**
	 * A queued checkout or purchase row.
	 *
	 * @param array $overrides Fields to override.
	 * @return object
	 */
	private function commerce_row( array $overrides = array() ) {
		$event = Conversions::build_event( $this->eligible_transaction(), 'Purchase', $this->event_context() );
		return (object) array_merge( $event, $overrides );
	}

	/** The stored snapshot becomes Meta's standard and custom parameters, alongside commerce data. */
	public function test_payload_maps_context_to_meta_parameters() {
		foreach ( array( 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$payload = Conversions::payload_for( $this->commerce_row( array( 'event_name' => $event_name ) ) );
			$this->assertSame( $event_name, $payload['event_name'] );
			$this->assertSame( 'Mix & Move', $payload['custom_data']['content_name'] );
			$this->assertSame( array( '12' ), $payload['custom_data']['content_ids'] );
			$this->assertSame( 31, $payload['custom_data']['event_date_id'] );
			$this->assertSame( '2026-11-12', $payload['custom_data']['event_start_date'] );
			$this->assertSame( 12.5, $payload['custom_data']['value'] );
			$this->assertSame( 'EUR', $payload['custom_data']['currency'] );
			$this->assertSame( 'test', $payload['custom_data']['payment_mode'] );
			$this->assertSame( array( 'fbp' => 'fb.1.1712345678901.click_ABC-2' ), $payload['user_data'] );
		}
	}

	/** Rows queued before snapshots existed, or with a malformed one, are delivered without context. */
	public function test_payload_without_usable_context_keeps_commerce_data() {
		$legacy = $this->commerce_row();
		unset( $legacy->event_context );
		$rows = array(
			$legacy,
			$this->commerce_row( array( 'event_context' => null ) ),
			$this->commerce_row( array( 'event_context' => '{not json' ) ),
			$this->commerce_row( array( 'event_context' => '"string"' ) ),
		);
		foreach ( $rows as $row ) {
			$payload = Conversions::payload_for( $row );
			$this->assertSame( array( 'value', 'currency', 'payment_mode', 'order_id' ), array_keys( $payload['custom_data'] ) );
		}
	}

	/** A partial snapshot sends only its valid fields. */
	public function test_payload_with_partial_context_sends_valid_fields_only() {
		$payload = Conversions::payload_for( $this->commerce_row( array( 'event_context' => '{"content_name":"Jam","event_date_id":"x"}' ) ) );
		$this->assertSame( 'Jam', $payload['custom_data']['content_name'] );
		$this->assertArrayNotHasKey( 'event_date_id', $payload['custom_data'] );
		$this->assertArrayNotHasKey( 'content_ids', $payload['custom_data'] );
	}

	/** Routine delivery sends the context with the unchanged event ID and no Test Events code. */
	public function test_routine_delivery_sends_context_without_test_code() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$row = $this->commerce_row();
		( new Conversions() )->send_payload( Conversions::payload_for( $row ) );
		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertArrayNotHasKey( 'test_event_code', $body );
		$this->assertSame( Conversions::event_id( 42, 'Purchase' ), $body['data'][0]['event_id'] );
		$this->assertSame( array( '12' ), $body['data'][0]['custom_data']['content_ids'] );
		$this->assertSame( '42', $body['data'][0]['custom_data']['order_id'] );
	}

	/** Engagement payloads are unchanged by the commerce context. */
	public function test_engagement_payload_has_no_commerce_context() {
		$row     = (object) Conversions::build_engagement_event(
			'calendar',
			'3f2c8a4e-1b7d-4c9a-8e2f-0a1b2c3d4e5f',
			array(
				'post_id'       => 12,
				'event_date_id' => 34,
				'source_url'    => 'https://example.test/event',
			),
			'fb.1.1712345678901.browser',
			''
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( array( 'post_id', 'event_date_id', 'action' ), array_keys( $payload['custom_data'] ) );
	}

	/** The payment-mode helper reads the transaction's raw testmode flag. */
	public function test_payment_mode_helper_reads_the_transaction_flag() {
		$this->assertSame( 'live', Conversions::payment_mode( (object) array( 'testmode' => 0 ) ) );
		$this->assertSame( 'test', Conversions::payment_mode( (object) array( 'testmode' => 1 ) ) );
	}

	/** Routine delivery (as deliver_due() calls it, with no explicit test code) omits test_event_code entirely. */
	public function test_send_payload_omits_test_event_code_for_routine_delivery() {
		$this->configure_credentials();
		$result = ( new Conversions() )->send_payload( $this->sample_event() );
		$this->assertTrue( $result['accepted'] );
		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertArrayNotHasKey( 'test_event_code', $body );
	}

	/** A missing Test Events code never blocks routine conversion delivery — only credentials do. */
	public function test_send_payload_delivers_without_a_configured_test_event_code() {
		$this->configure_credentials();
		$this->assertSame( '', (string) get_option( Conversions::TEST_CODE_OPTION, '' ) );
		$result = ( new Conversions() )->send_payload( $this->sample_event() );
		$this->assertTrue( $result['accepted'] );
	}

	/** Send_payload() still supports an explicit test code for the synthetic test path. */
	public function test_send_payload_includes_test_event_code_when_explicitly_provided() {
		$this->configure_credentials();
		( new Conversions() )->send_payload( $this->sample_event(), 'CODE123' );
		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertSame( 'CODE123', $body['test_event_code'] );
	}

	/** The explicit administrator-triggered synthetic test still attaches the configured Test Events code. */
	public function test_send_test_includes_the_configured_test_event_code() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$result = ( new Conversions() )->send_test();
		$this->assertTrue( $result['accepted'] );
		$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
		$this->assertSame( 'CODE123', $body['test_event_code'] );
		$this->assertSame( 'PageView', $body['data'][0]['event_name'] );
	}

	/** Without a configured Test Events code, the synthetic test fails closed before any network call, regardless of event type. */
	public function test_send_test_fails_closed_without_a_configured_test_event_code() {
		$this->configure_credentials();
		$result = ( new Conversions() )->send_test( 'Purchase' );
		$this->assertFalse( $result['accepted'] );
		$this->assertSame( 'missing_test_code', $result['code'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/** Each administrator-selectable event type is sent and named correctly. */
	public function test_send_test_sends_the_selected_event_name() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		foreach ( array( 'PageView', 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$GLOBALS['_fair_test_remote_post_requests'] = array();
			$result                                     = ( new Conversions() )->send_test( $event_name );
			$this->assertTrue( $result['accepted'] );
			$body = json_decode( $GLOBALS['_fair_test_remote_post_requests'][0]['args']['body'], true );
			$this->assertSame( $event_name, $body['data'][0]['event_name'] );
			$this->assertSame( 'CODE123', $body['test_event_code'] );
		}
	}

	/** PageView carries no commerce data. */
	public function test_build_test_event_omits_commerce_data_for_page_view() {
		$event = Conversions::build_test_event( 'PageView' );
		$this->assertSame( array(), $event['custom_data'] );
	}

	/** InitiateCheckout and Purchase carry a fixed sample value and currency, since Meta expects commerce fields for these event types. */
	public function test_build_test_event_includes_sample_commerce_data() {
		foreach ( array( 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$event = Conversions::build_test_event( $event_name );
			$this->assertArrayHasKey( 'value', $event['custom_data'] );
			$this->assertArrayHasKey( 'currency', $event['custom_data'] );
		}
	}

	/** Checkout and purchase samples carry fixed synthetic event context; PageView does not. */
	public function test_build_test_event_includes_synthetic_event_context() {
		foreach ( array( 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$custom = Conversions::build_test_event( $event_name )['custom_data'];
			$this->assertSame( 'Fair Events test event', $custom['content_name'] );
			$this->assertSame( array( 'fair-events-test-event' ), $custom['content_ids'] );
			$this->assertSame( 0, $custom['event_date_id'] );
			$this->assertSame( '2000-01-01', $custom['event_start_date'] );
		}
		$this->assertArrayNotHasKey( 'content_name', Conversions::build_test_event( 'PageView' )['custom_data'] );
	}

	/** The synthetic test event never references a real transaction or order — only the Test Events code marks it as a test. */
	public function test_build_test_event_never_includes_an_order_id() {
		foreach ( array( 'PageView', 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$event = Conversions::build_test_event( $event_name );
			$this->assertArrayNotHasKey( 'order_id', $event['custom_data'] );
			$this->assertArrayNotHasKey( 'transaction_id', $event );
		}
	}

	/** A successfully delivered test event is recorded in the history log. */
	public function test_send_test_records_an_accepted_history_entry() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		( new Conversions() )->send_test( 'PageView' );
		$history = Conversions::test_history();
		$this->assertCount( 1, $history );
		$this->assertSame( 'PageView', $history[0]['event_name'] );
		$this->assertTrue( $history[0]['accepted'] );
	}

	/** A rejected test event is recorded with its safe code/type, never the raw response body. */
	public function test_send_test_records_a_rejected_history_entry() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$GLOBALS['_fair_test_remote_post_response'] = array(
			'response' => array( 'code' => 400 ),
			'body'     => wp_json_encode(
				array(
					'error' => array(
						'code' => 'oauth_error',
						'type' => 'OAuthException',
					),
				)
			),
		);
		( new Conversions() )->send_test( 'Purchase' );
		$history = Conversions::test_history();
		$this->assertCount( 1, $history );
		$this->assertSame( 'Purchase', $history[0]['event_name'] );
		$this->assertFalse( $history[0]['accepted'] );
		$this->assertSame( 'oauth_error', $history[0]['code'] );
		$this->assertSame( 'oauthexception', $history[0]['type'] );
		$this->assertArrayNotHasKey( 'access_token', $history[0] );
		$this->assertArrayNotHasKey( 'dataset_id', $history[0] );
	}

	/** The history log never grows past its retention limit and stays newest-first. */
	public function test_send_test_history_trims_to_the_limit() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$conversions = new Conversions();
		foreach ( array( 'PageView', 'InitiateCheckout', 'Purchase', 'PageView', 'InitiateCheckout', 'Purchase' ) as $event_name ) {
			$conversions->send_test( $event_name );
		}
		$history = Conversions::test_history();
		$this->assertCount( Conversions::TEST_LOG_LIMIT, $history );
		$this->assertSame( 'Purchase', $history[0]['event_name'] );
	}

	/** The fail-closed missing-code path never calls send_payload(), so it is not recorded in the history log. */
	public function test_send_test_does_not_record_the_missing_test_code_fail_closed_path() {
		$this->configure_credentials();
		( new Conversions() )->send_test( 'Purchase' );
		$this->assertSame( array(), Conversions::test_history() );
	}

	/**
	 * Successful HTTP responses that do not confirm one received event.
	 *
	 * @return array
	 */
	public static function unconfirmed_responses() {
		return array(
			'zero events'    => array( '{"events_received":0,"messages":[]}', 'events_received_0', 0 ),
			'missing count'  => array( '{"messages":[]}', 'missing_events_received', null ),
			'invalid count'  => array( '{"events_received":"one"}', 'missing_events_received', null ),
			'malformed JSON' => array( 'not json', 'malformed_response', null ),
			'empty object'   => array( '{}', 'missing_events_received', null ),
			'two events'     => array( '{"events_received":2}', 'events_received_2', 2 ),
		);
	}

	/**
	 * HTTP success alone is never treated as received; it is unconfirmed and retryable.
	 *
	 * @dataProvider unconfirmed_responses
	 * @param string   $body     Response body.
	 * @param string   $code     Expected code.
	 * @param int|null $received Expected events_received diagnostic.
	 */
	public function test_unconfirmed_success_is_not_accepted( $body, $code, $received ) {
		$this->configure_credentials();
		$GLOBALS['_fair_test_remote_post_response'] = $this->meta_response( 200, $body );
		$result                                     = ( new Conversions() )->send_payload( $this->sample_event() );
		$this->assertFalse( $result['accepted'] );
		$this->assertTrue( $result['temporary'] );
		$this->assertSame( 'unconfirmed', $result['outcome'] );
		$this->assertSame( 'unconfirmed', $result['type'] );
		$this->assertSame( $code, $result['code'] );
		$this->assertSame( 200, $result['diagnostics']['http_status'] );
		$this->assertSame( $received, $result['diagnostics']['events_received'] );
	}

	/** One confirmed event is received, with Meta's diagnostics kept. */
	public function test_confirmed_event_is_received_with_diagnostics() {
		$this->configure_credentials();
		$GLOBALS['_fair_test_remote_post_response'] = $this->meta_response(
			200,
			array(
				'events_received' => 1,
				'messages'        => array(),
				'fbtrace_id'      => 'AbC_trace-1',
				'unexpected'      => 'dropped',
			)
		);
		$result                                     = ( new Conversions() )->send_payload( $this->sample_event() );
		$this->assertTrue( $result['accepted'] );
		$this->assertSame( 'received', $result['outcome'] );
		$this->assertSame(
			array(
				'http_status'     => 200,
				'events_received' => 1,
				'messages'        => array(),
				'fbtrace_id'      => 'AbC_trace-1',
			),
			$result['diagnostics']
		);
	}

	/** A 4xx is a permanent rejection carrying the error trace ID and redacted messages. */
	public function test_rejection_keeps_error_trace_and_redacts_messages() {
		$this->configure_credentials();
		$GLOBALS['_fair_test_remote_post_response'] = $this->meta_response(
			400,
			array(
				'error' => array(
					'message'    => 'Invalid parameter token-value for fb.1.1712345678901.browser <b>bold</b>',
					'type'       => 'OAuthException',
					'code'       => 100,
					'fbtrace_id' => 'ErrTrace9',
				),
			)
		);
		$result                                     = ( new Conversions() )->send_payload( $this->sample_event() );
		$this->assertFalse( $result['accepted'] );
		$this->assertFalse( $result['temporary'] );
		$this->assertSame( 'rejected', $result['outcome'] );
		$this->assertSame( '100', $result['code'] );
		$this->assertSame( 'oauthexception', $result['type'] );
		$this->assertSame( 400, $result['diagnostics']['http_status'] );
		$this->assertNull( $result['diagnostics']['events_received'] );
		$this->assertSame( 'ErrTrace9', $result['diagnostics']['fbtrace_id'] );
		$this->assertSame( array( 'Invalid parameter [redacted] for [redacted] bold' ), $result['diagnostics']['messages'] );
	}

	/** Rate limits and server errors stay temporary; failed requests carry no HTTP diagnostics. */
	public function test_temporary_and_transport_failures() {
		$this->configure_credentials();
		foreach ( array( 429, 500, 503 ) as $status ) {
			$GLOBALS['_fair_test_remote_post_response'] = $this->meta_response( $status, '' );
			$result                                     = ( new Conversions() )->send_payload( $this->sample_event() );
			$this->assertTrue( $result['temporary'], (string) $status );
			$this->assertSame( 'temporary_error', $result['outcome'] );
			$this->assertSame( $status, $result['diagnostics']['http_status'] );
		}
		$GLOBALS['_fair_test_remote_post_response'] = new \WP_Error( 'http_request_failed', 'timeout' );
		$result                                     = ( new Conversions() )->send_payload( $this->sample_event() );
		$this->assertTrue( $result['temporary'] );
		$this->assertSame( 'transport', $result['outcome'] );
		$this->assertNull( $result['diagnostics']['http_status'] );
	}

	/** Messages are bounded in count and length, non-strings become text, and a bad trace ID is dropped. */
	public function test_diagnostics_are_bounded() {
		$diagnostics = Conversions::diagnostics_from(
			200,
			array(
				'events_received' => 1,
				'messages'        => array_merge( array( str_repeat( 'a', 1000 ), array( 'nested' => 'x' ) ), array_fill( 0, 10, 'more' ) ),
				'fbtrace_id'      => '<script>',
			)
		);
		$this->assertCount( Conversions::MESSAGE_LIMIT, $diagnostics['messages'] );
		$this->assertSame( Conversions::MESSAGE_LENGTH, strlen( $diagnostics['messages'][0] ) );
		$this->assertSame( '{"nested":"x"}', $diagnostics['messages'][1] );
		$this->assertNull( $diagnostics['fbtrace_id'] );
	}

	/** Test history keeps the diagnostics of failed sends too, never the raw body. */
	public function test_history_records_diagnostics_for_failures() {
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		$GLOBALS['_fair_test_remote_post_response'] = $this->meta_response(
			200,
			array(
				'events_received' => 0,
				'messages'        => array( 'Dropped' ),
				'fbtrace_id'      => 'T1',
				'raw'             => 'secret-ish',
			)
		);
		( new Conversions() )->send_test( 'PageView' );
		$entry = Conversions::test_history()[0];
		$this->assertFalse( $entry['accepted'] );
		$this->assertSame( 'unconfirmed', $entry['outcome'] );
		$this->assertSame( 0, $entry['events_received'] );
		$this->assertSame( array( 'Dropped' ), $entry['messages'] );
		$this->assertSame( 'T1', $entry['fbtrace_id'] );
		$this->assertSame( 200, $entry['http_status'] );
		$this->assertArrayNotHasKey( 'raw', $entry );
	}

	/** History written before diagnostics existed is still read, and malformed entries are skipped. */
	public function test_legacy_history_is_still_read() {
		$legacy = array(
			'event_name' => 'PageView',
			'accepted'   => true,
			'code'       => '',
			'type'       => '',
			'time'       => '2025-12-01 00:00:00',
		);
		update_option( Conversions::TEST_LOG_OPTION, array( $legacy, 'garbage' ) );
		$this->assertSame( array( $legacy ), Conversions::test_history() );
		$this->configure_credentials();
		update_option( Conversions::TEST_CODE_OPTION, 'CODE123' );
		( new Conversions() )->send_test( 'PageView' );
		$history = Conversions::test_history();
		$this->assertCount( 2, $history );
		$this->assertSame( $legacy, $history[1] );
	}
}
