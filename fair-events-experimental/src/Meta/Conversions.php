<?php
/**
 * Meta Conversions API orchestration.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Coordinates conversion capture, payloads and delivery. */
class Conversions {
	public const GRAPH_API_VERSION = 'v26.0';
	public const DATASET_OPTION    = 'fair_events_experimental_meta_dataset_id';
	public const TOKEN_OPTION      = 'fair_events_experimental_meta_access_token';
	public const TEST_CODE_OPTION  = 'fair_events_experimental_meta_test_event_code';
	public const TEST_LOG_OPTION   = 'fair_events_experimental_meta_test_log';
	public const TEST_LOG_LIMIT    = 5;
	public const MESSAGE_LIMIT     = 5;
	public const MESSAGE_LENGTH    = 300;
	public const DELIVERY_HOOK     = 'fair_events_experimental_meta_deliver';
	public const CLEANUP_HOOK      = 'fair_events_experimental_meta_cleanup';
	public const QUEUED_TIMEOUT    = 10;
	public const IMMEDIATE_TIMEOUT = 10;

	/** Custom engagement events by button action; distinct from checkout and purchase. */
	public const ENGAGEMENT_EVENTS = array(
		'calendar' => 'FairEventCalendarClick',
		'ticket'   => 'FairEventTicketClick',
	);

	/**
	 * Register hooks. Delivery and cleanup always run; checkout and purchase
	 * measurement is wired only when Fair Payments Connector is available.
	 */
	public function init() {
		add_action( self::DELIVERY_HOOK, array( $this, 'deliver_due' ) );
		add_action( self::CLEANUP_HOOK, array( $this, 'cleanup' ) );
		if ( ! self::payments_available() ) {
			return;
		}
		add_action( 'fair_payment_payment_initiated', array( $this, 'checkout_initiated' ), 10, 2 );
		add_action( 'fair_payment_paid', array( $this, 'payment_paid' ), 10, 2 );
		add_filter( 'fair_payment_before_initiate_payment', array( $this, 'remove_provider_attribution' ) );
	}

	/** Whether Fair Payments Connector's transactions can be read. @return bool */
	public static function payments_available() {
		return class_exists( \FairPaymentsConnector\Models\Transaction::class );
	}

	/** Whether a dataset ID and an access token from {@see Connector} are in effect. @return bool */
	public static function configured() {
		return '' !== (string) get_option( self::DATASET_OPTION, '' ) && '' !== Connector::token();
	}

	/** @param array $args Provider args. @return array */
	public function remove_provider_attribution( $args ) {
		if ( isset( $args['metadata'] ) && is_array( $args['metadata'] ) ) {
			unset( $args['metadata']['meta_consent'], $args['metadata']['meta_fbp'], $args['metadata']['meta_fbc'], $args['metadata']['meta_source_url'] );
		}
		return $args;
	}

	/** @param int $transaction_id Transaction ID. */
	public function checkout_initiated( $transaction_id ) {
		if ( ! self::payments_available() ) {
			return;
		}
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
		if ( ! $transaction || empty( $transaction->checkout_url ) ) {
			return;
		}
		$this->enqueue_transaction( $transaction, 'InitiateCheckout' );
	}

	/** @param object $payment Provider payment. @param object $transaction Transaction. */
	public function payment_paid( $payment, $transaction ) {
		unset( $payment );
		if ( ! self::payments_available() ) {
			return;
		}
		$fresh = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $transaction->id );
		if ( ! $fresh || 'paid' !== (string) $fresh->status ) {
			return;
		}
		$this->enqueue_transaction( $fresh, 'Purchase' );
	}

	/** @param object $transaction Transaction. @param string $event_name Event name. @return bool */
	public function enqueue_transaction( $transaction, $event_name ) {
		if ( ! self::configured() || ! self::build_event( $transaction, $event_name ) ) {
			return false;
		}
		// Look up event context only for an eligible transaction. It is
		// snapshotted now, so retries never depend on later event edits.
		return self::queue( self::build_event( $transaction, $event_name, ( new PurchaseContext() )->for_transaction( $transaction ) ) );
	}

	/**
	 * Send a button-click engagement event to Meta now, in the request that
	 * captured it, instead of queuing it. The event is reserved in the outbox
	 * first, so a duplicate request — or a replay of an activation queued
	 * before immediate delivery — sends nothing. It is one bounded attempt
	 * with no retry: a failure loses the measurement, which keeps
	 * best-effort click tracking independent of background scheduling.
	 * Like queued delivery, it is a production event without
	 * `test_event_code`.
	 *
	 * @param array $event Event from {@see build_engagement_event()}.
	 * @return bool Whether Meta confirmed receiving the event.
	 */
	public function deliver_engagement( $event ) {
		$outbox = new Outbox();
		if ( ! self::configured() || ! $outbox->reserve_immediate( $event ) ) {
			return false;
		}
		$result = $this->send_payload( self::payload_for( (object) $event ), '', self::IMMEDIATE_TIMEOUT );
		$outbox->finish_immediate( $event['event_id'], $result );
		return $result['accepted'];
	}

	/** @param array $event Outbox event. @return bool */
	private static function queue( $event ) {
		$inserted = ( new Outbox() )->enqueue( $event );
		if ( $inserted && ! wp_next_scheduled( self::DELIVERY_HOOK ) ) {
			wp_schedule_single_event( time() + 1, self::DELIVERY_HOOK );
		}
		return $inserted;
	}

	/**
	 * Build the outbox row for an eligible transaction, independent of Meta
	 * configuration or persistence — a pure transformation so eligibility and
	 * payload shape can be unit tested without a database.
	 *
	 * Eligibility: the transaction must originate from the unified checkout
	 * (`fair-events-get-tickets`), carry current marketing consent, and carry
	 * at least one valid Meta browser identifier. Payment mode (test/live) is
	 * captured from the transaction but never gates eligibility — both modes
	 * report as production Meta events, distinguished only by
	 * `custom_data.payment_mode`, so admins can verify checkout end to end.
	 *
	 * `$context` is the {@see PurchaseContext} the caller resolved; it is
	 * stored as a JSON snapshot, or as an empty string when nothing resolved.
	 *
	 * @param object $transaction Transaction. @param string $event_name Event name. @param array $context Event context. @return array|null
	 */
	public static function build_event( $transaction, $event_name, $context = array() ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( ! is_array( $metadata ) || 'fair-events-get-tickets' !== ( $metadata['source'] ?? '' ) || empty( $metadata['meta_consent'] ) || ( empty( $metadata['meta_fbp'] ) && empty( $metadata['meta_fbc'] ) ) ) {
			return null;
		}
		$context = PurchaseContext::normalize( $context );
		$time    = 'InitiateCheckout' === $event_name && ! empty( $transaction->payment_initiated_at ) ? strtotime( $transaction->payment_initiated_at . ' UTC' ) : strtotime( $transaction->updated_at . ' UTC' );
		$event   = array(
			'transaction_id' => (int) $transaction->id,
			'event_name'     => $event_name,
			'event_id'       => self::event_id( (int) $transaction->id, $event_name ),
			'event_time'     => $time ? $time : time(),
			'source_url'     => esc_url_raw( $metadata['meta_source_url'] ?? '' ),
			'value'          => (float) $transaction->amount,
			'currency'       => strtoupper( sanitize_key( $transaction->currency ) ),
			'order_id'       => 'Purchase' === $event_name ? (string) $transaction->id : '',
			'payment_mode'   => self::payment_mode( $transaction ),
			'fbp'            => self::valid_identifier( $metadata['meta_fbp'] ?? '' ) ? $metadata['meta_fbp'] : '',
			'fbc'            => self::valid_identifier( $metadata['meta_fbc'] ?? '' ) ? $metadata['meta_fbc'] : '',
			'event_context'  => $context ? (string) wp_json_encode( $context ) : '',
		);
		if ( '' === $event['fbp'] && '' === $event['fbc'] ) {
			return null;
		}
		return $event;
	}

	/**
	 * Build the outbox row for a button-click engagement event — a pure
	 * transformation like {@see build_event()}. It carries only the event
	 * context and Meta identifiers: no commerce value, currency, order ID or
	 * payment mode, and never the button's destination or text. The
	 * browser User-Agent, normalized by {@see Engagement::user_agent()}, is
	 * carried for the send only; the outbox never stores it. The event ID
	 * derives from the activation ID alone, so replaying an activation —
	 * even under another action — cannot queue a second event.
	 *
	 * @param string $action        'calendar' or 'ticket'.
	 * @param string $activation_id Browser activation UUID.
	 * @param array  $context       {@see Engagement::event_context()} result.
	 * @param string $fbp           Meta browser ID.
	 * @param string $fbc           Meta click ID.
	 * @param mixed  $user_agent    Browser User-Agent header, or ''.
	 * @return array|null
	 */
	public static function build_engagement_event( $action, $activation_id, $context, $fbp, $fbc, $user_agent = '' ) {
		$fbp = self::valid_identifier( $fbp ) ? $fbp : '';
		$fbc = self::valid_identifier( $fbc ) ? $fbc : '';
		if ( ! isset( self::ENGAGEMENT_EVENTS[ $action ] ) || ! self::valid_activation_id( $activation_id ) || ( '' === $fbp && '' === $fbc ) ) {
			return null;
		}
		return array(
			'event_post_id'     => (int) $context['post_id'],
			'event_date_id'     => (int) $context['event_date_id'],
			'event_name'        => self::ENGAGEMENT_EVENTS[ $action ],
			'event_id'          => hash( 'sha256', home_url( '/' ) . '|engagement|' . strtolower( $activation_id ) ),
			'event_time'        => time(),
			'source_url'        => esc_url_raw( $context['source_url'] ),
			'value'             => 0,
			'currency'          => '',
			'order_id'          => '',
			'payment_mode'      => '',
			'fbp'               => $fbp,
			'fbc'               => $fbc,
			'client_user_agent' => Engagement::user_agent( $user_agent ),
		);
	}

	/** @param string $value Activation ID. @return bool Whether it is a version 4 UUID. */
	public static function valid_activation_id( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value );
	}

	/** @param object $transaction Transaction. @return string 'test' or 'live'. */
	public static function payment_mode( $transaction ) {
		return 0 === (int) $transaction->testmode ? 'live' : 'test';
	}

	/** @param int $transaction_id Transaction ID. @param string $event_name Event name. @return string */
	public static function event_id( $transaction_id, $event_name ) {
		return hash( 'sha256', home_url( '/' ) . '|' . $transaction_id . '|' . $event_name );
	}

	/** @param string $value Identifier. @return bool */
	public static function valid_identifier( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{1,128}$/', $value );
	}

	/** @param object $row Outbox row. @return array */
	public static function payload_for( $row ) {
		$user_data = array_filter(
			array(
				'fbp'               => $row->fbp,
				'fbc'               => $row->fbc,
				// Only an in-memory engagement event has it; stored rows never do.
				'client_user_agent' => $row->client_user_agent ?? '',
			)
		);
		$action    = array_search( $row->event_name, self::ENGAGEMENT_EVENTS, true );
		if ( false !== $action ) {
			$custom = array(
				'post_id'       => (int) $row->event_post_id,
				'event_date_id' => (int) $row->event_date_id,
				'action'        => $action,
			);
		} else {
			$custom = array(
				'value'        => (float) $row->value,
				'currency'     => $row->currency,
				'payment_mode' => $row->payment_mode,
			);
			if ( '' !== $row->order_id ) {
				$custom['order_id'] = $row->order_id;
			}
			$custom = array_merge( $custom, self::stored_context( $row ) );
		}
		return array(
			'event_name'       => $row->event_name,
			'event_time'       => (int) $row->event_time,
			'event_id'         => $row->event_id,
			'action_source'    => 'website',
			'event_source_url' => $row->source_url,
			'user_data'        => $user_data,
			'custom_data'      => $custom,
		);
	}

	/**
	 * The event context snapshot of a checkout or purchase row. Rows queued
	 * before snapshots existed, and malformed snapshots, yield no context.
	 *
	 * @param object $row Outbox row. @return array
	 */
	private static function stored_context( $row ) {
		if ( empty( $row->event_context ) || ! is_string( $row->event_context ) ) {
			return array();
		}
		return PurchaseContext::normalize( json_decode( $row->event_context, true ) );
	}

	/**
	 * Deliver queued rows — checkout, purchase, and engagement clicks queued
	 * before immediate delivery — without affecting payment state. Every
	 * event — test mode and live mode alike — is sent once as a production
	 * Meta event, with no `test_event_code` attached; `payment_mode` in
	 * `custom_data` remains the only way to tell the two apart. The configured Test Events code is
	 * reserved for the explicit administrator-triggered tests in
	 * {@see send_test()} and never gates or accompanies routine delivery.
	 *
	 * A row is `received` only once Meta confirms the event in
	 * `events_received`. An unconfirmed answer is retried on the same bounded
	 * schedule as a temporary error, with the same event ID so Meta can
	 * deduplicate it. Rows finished before confirmation was checked keep
	 * their `accepted` state: it records an HTTP success only.
	 */
	public function deliver_due() {
		$outbox = new Outbox();
		$row    = $outbox->claim_due();
		while ( $row ) {
			$result = $this->send_payload( self::payload_for( $row ) );
			if ( $result['accepted'] ) {
				$outbox->finish( (int) $row->id, 'received', '', '', $result['diagnostics'] );
			} elseif ( $result['temporary'] ) {
				$outbox->retry( $row, $result['code'], $result['type'], 'unconfirmed' === $result['outcome'] ? 'unconfirmed' : 'temporary_error', $result['diagnostics'] );
			} else {
				$outbox->finish( (int) $row->id, 'configuration_error', $result['code'], $result['type'], $result['diagnostics'] );
			}
			$row = $outbox->claim_due();
		}
	}

	/**
	 * Send one event and classify Meta's answer.
	 *
	 * `outcome` is `received` only when HTTP succeeds and the body confirms
	 * `events_received: 1`. A successful status with zero events, a missing or
	 * invalid count, or a malformed body is `unconfirmed` and temporary. A
	 * 4xx is `rejected`, 408/429/5xx `temporary_error`, and a failed request
	 * `transport`. `diagnostics` holds only the allowlisted, sanitized fields
	 * from {@see diagnostics_from()}.
	 *
	 * @param array $event Event. @param string $test_code Optional explicit test code. @param int $timeout Request timeout in seconds. @return array
	 */
	public function send_payload( $event, $test_code = '', $timeout = self::QUEUED_TIMEOUT ) {
		$dataset = (string) get_option( self::DATASET_OPTION, '' );
		$token   = Connector::token();
		if ( '' === $dataset || '' === $token ) {
			return self::result( 'configuration', false, 'missing_configuration', 'configuration' );
		}
		$body = array(
			'data'         => array( $event ),
			'access_token' => $token,
		);
		if ( '' !== $test_code ) {
			$body['test_event_code'] = $test_code;
		}
		$response = wp_remote_post(
			'https://graph.facebook.com/' . self::GRAPH_API_VERSION . '/' . rawurlencode( $dataset ) . '/events',
			array(
				'timeout' => $timeout,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return self::result( 'transport', true, 'network', 'transport' );
		}
		$status      = (int) wp_remote_retrieve_response_code( $response );
		$data        = json_decode( wp_remote_retrieve_body( $response ), true );
		$data        = is_array( $data ) ? $data : null;
		$diagnostics = self::diagnostics_from( $status, $data, array( $token, $test_code ) );
		if ( $status >= 200 && $status < 300 ) {
			if ( null === $data ) {
				return self::result( 'unconfirmed', true, 'malformed_response', 'unconfirmed', $diagnostics );
			}
			if ( null === $diagnostics['events_received'] ) {
				return self::result( 'unconfirmed', true, 'missing_events_received', 'unconfirmed', $diagnostics );
			}
			if ( 1 !== $diagnostics['events_received'] ) {
				return self::result( 'unconfirmed', true, 'events_received_' . $diagnostics['events_received'], 'unconfirmed', $diagnostics );
			}
			return self::result( 'received', false, '', '', $diagnostics );
		}
		$temporary = 408 === $status || 429 === $status || $status >= 500;
		return self::result(
			$temporary ? 'temporary_error' : 'rejected',
			$temporary,
			sanitize_key( (string) ( $data['error']['code'] ?? $status ) ),
			sanitize_key( (string) ( $data['error']['type'] ?? 'http' ) ),
			$diagnostics
		);
	}

	/**
	 * @param string     $outcome     received, unconfirmed, rejected, temporary_error, transport or configuration.
	 * @param bool       $temporary   Whether a later retry may succeed.
	 * @param string     $code        Safe code.
	 * @param string     $type        Safe type.
	 * @param array|null $diagnostics {@see diagnostics_from()} result, when Meta answered.
	 * @return array
	 */
	private static function result( $outcome, $temporary, $code, $type, $diagnostics = null ) {
		return array(
			'accepted'    => 'received' === $outcome,
			'temporary'   => $temporary,
			'outcome'     => $outcome,
			'code'        => $code,
			'type'        => $type,
			'diagnostics' => $diagnostics ? $diagnostics : self::diagnostics_from( null, null ),
		);
	}

	/**
	 * The allowlisted diagnostics of a Meta answer: HTTP status, the
	 * `events_received` count, `messages` (Meta's top-level messages, plus an
	 * error's message) and the `fbtrace_id` (or the error's trace ID). A field
	 * Meta left out stays null, so it can be told apart from an empty list or
	 * a zero count. Messages are bounded, stripped to plain text, and have
	 * credentials and Meta browser identifiers redacted; nothing else from
	 * the body is kept.
	 *
	 * @param int|null   $status   HTTP status, or null without a response.
	 * @param array|null $data     Decoded body, or null when not JSON.
	 * @param string[]   $secrets  Values to redact from messages.
	 * @return array
	 */
	public static function diagnostics_from( $status, $data, $secrets = array() ) {
		$count = $data['events_received'] ?? null;
		if ( is_string( $count ) && ctype_digit( $count ) ) {
			$count = (int) $count;
		}
		$messages = null;
		if ( isset( $data['messages'] ) && is_array( $data['messages'] ) ) {
			$messages = array_values( $data['messages'] );
		}
		if ( isset( $data['error'] ) && is_array( $data['error'] ) ) {
			$messages = array_merge(
				$messages ? $messages : array(),
				array_filter( array( $data['error']['message'] ?? '', $data['error']['error_user_msg'] ?? '' ) )
			);
		}
		if ( null !== $messages ) {
			$messages = array_slice(
				array_values(
					array_filter(
						array_map(
							static fn( $message ) => self::safe_message( $message, $secrets ),
							$messages
						)
					)
				),
				0,
				self::MESSAGE_LIMIT
			);
		}
		$trace = $data['fbtrace_id'] ?? ( $data['error']['fbtrace_id'] ?? null );
		return array(
			'http_status'     => null === $status ? null : (int) $status,
			'events_received' => is_int( $count ) && $count >= 0 ? $count : null,
			'messages'        => $messages,
			'fbtrace_id'      => is_string( $trace ) && preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $trace ) ? $trace : null,
		);
	}

	/**
	 * @param mixed    $message Meta message; anything but a string becomes JSON text.
	 * @param string[] $secrets Values to redact.
	 * @return string Plain, bounded text with credentials and identifiers redacted.
	 */
	private static function safe_message( $message, $secrets ) {
		$text = is_string( $message ) ? $message : (string) wp_json_encode( $message );
		foreach ( array_filter( $secrets, 'strlen' ) as $secret ) {
			$text = str_replace( $secret, '[redacted]', $text );
		}
		$text = (string) preg_replace( '/fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{1,128}/', '[redacted]', $text );
		$text = (string) preg_replace( '/access_token=[^&\s"]+/i', 'access_token=[redacted]', $text );
		$text = sanitize_text_field( $text );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, self::MESSAGE_LENGTH ) : substr( $text, 0, self::MESSAGE_LENGTH );
	}

	/**
	 * Send an administrator-triggered test with the saved Test Events code.
	 * PageView, InitiateCheckout and Purchase are synthetic; the calendar
	 * test goes through the production engagement builders with the given
	 * context, so its payload matches a real calendar activation. No outbox
	 * row is created either way.
	 *
	 * @param string     $event_name PageView, InitiateCheckout, Purchase or FairEventCalendarClick.
	 * @param array|null $engagement For the calendar test: `context` ({@see Engagement::event_context()}), `fbp`, `fbc` and `user_agent`.
	 * @return array {@see send_payload()} result.
	 */
	public function send_test( $event_name = 'PageView', $engagement = null ) {
		$code = (string) get_option( self::TEST_CODE_OPTION, '' );
		if ( '' === $code ) {
			return self::result( 'configuration', false, 'missing_test_code', 'configuration' );
		}
		if ( self::ENGAGEMENT_EVENTS['calendar'] === $event_name ) {
			$event = self::build_engagement_test_event( $engagement );
			if ( ! $event ) {
				return self::result( 'configuration', false, 'invalid_test_context', 'configuration' );
			}
		} else {
			$event = self::build_test_event( $event_name );
		}
		$result = $this->send_payload( $event, $code );
		self::append_test_history( $event_name, $result );
		return $result;
	}

	/**
	 * The calendar test payload, built exactly like a real activation — a
	 * fresh activation ID gives it a fresh event ID.
	 *
	 * @param array|null $engagement `context`, `fbp`, `fbc` and `user_agent`.
	 * @return array|null Meta payload, or null without valid context or identifiers.
	 */
	public static function build_engagement_test_event( $engagement ) {
		if ( ! is_array( $engagement ) || empty( $engagement['context'] ) ) {
			return null;
		}
		$row = self::build_engagement_event( 'calendar', wp_generate_uuid4(), $engagement['context'], (string) ( $engagement['fbp'] ?? '' ), (string) ( $engagement['fbc'] ?? '' ), $engagement['user_agent'] ?? '' );
		return $row ? self::payload_for( (object) $row ) : null;
	}

	/** @return array Up to {@see TEST_LOG_LIMIT} most recent test-send outcomes, newest first. */
	public static function test_history() {
		$history = get_option( self::TEST_LOG_OPTION, array() );
		return is_array( $history ) ? array_values( array_filter( $history, 'is_array' ) ) : array();
	}

	/**
	 * Record a test-send outcome, trimmed to {@see TEST_LOG_LIMIT} entries. Only
	 * the safe code/type and the allowlisted diagnostics {@see send_payload()}
	 * already computed are stored — never the raw Meta response body.
	 * Entries recorded before diagnostics existed simply lack those keys.
	 *
	 * @param string $event_name Test event name.
	 * @param array  $result send_payload() result.
	 */
	private static function append_test_history( $event_name, $result ) {
		$history = self::test_history();
		array_unshift(
			$history,
			array_merge(
				array(
					'event_name' => $event_name,
					'accepted'   => (bool) $result['accepted'],
					'outcome'    => sanitize_key( (string) $result['outcome'] ),
					'code'       => sanitize_key( (string) $result['code'] ),
					'type'       => sanitize_key( (string) $result['type'] ),
					'time'       => current_time( 'mysql', true ),
				),
				$result['diagnostics']
			)
		);
		update_option( self::TEST_LOG_OPTION, array_slice( $history, 0, self::TEST_LOG_LIMIT ), false );
	}

	/**
	 * Build a synthetic event for the administrator-triggered test, identified
	 * as a test only by the Test Events code {@see send_test()} attaches when
	 * delivering it — never by a stored transaction or order ID, so a
	 * `Purchase` test can never be mistaken for a real payment. Checkout and
	 * purchase samples carry fixed, clearly synthetic event context, so the
	 * parameter names can be inspected in Test Events.
	 *
	 * @param string $event_name PageView, InitiateCheckout, or Purchase. @return array
	 */
	public static function build_test_event( $event_name ) {
		$event = array(
			'event_name'       => $event_name,
			'event_time'       => time(),
			'event_id'         => wp_generate_uuid4(),
			'action_source'    => 'website',
			'event_source_url' => home_url( '/' ),
			'user_data'        => array( 'external_id' => array( hash( 'sha256', wp_generate_uuid4() ) ) ),
			'custom_data'      => array(),
		);
		if ( 'InitiateCheckout' === $event_name || 'Purchase' === $event_name ) {
			$event['custom_data'] = array(
				'value'            => 1.0,
				'currency'         => 'USD',
				'content_name'     => 'Fair Events test event',
				'content_ids'      => array( 'fair-events-test-event' ),
				'event_date_id'    => 0,
				'event_start_date' => '2000-01-01',
			);
		}
		return $event;
	}

	/** Purge retained delivery rows. */
	public function cleanup() {
		( new Outbox() )->cleanup(); }
}
