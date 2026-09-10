<?php
/**
 * Meta Conversions API orchestration.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Coordinates conversion capture, payloads and asynchronous delivery. */
class Conversions {
	public const GRAPH_API_VERSION = 'v26.0';
	public const DATASET_OPTION    = 'fair_events_experimental_meta_dataset_id';
	public const TOKEN_OPTION      = 'fair_events_experimental_meta_access_token';
	public const TEST_CODE_OPTION  = 'fair_events_experimental_meta_test_event_code';
	public const DELIVERY_HOOK     = 'fair_events_experimental_meta_deliver';
	public const CLEANUP_HOOK      = 'fair_events_experimental_meta_cleanup';

	/** Register hooks. */
	public function init() {
		add_action( 'fair_payment_payment_initiated', array( $this, 'checkout_initiated' ), 10, 2 );
		add_action( 'fair_payment_paid', array( $this, 'payment_paid' ), 10, 2 );
		add_action( self::DELIVERY_HOOK, array( $this, 'deliver_due' ) );
		add_action( self::CLEANUP_HOOK, array( $this, 'cleanup' ) );
		add_filter( 'fair_payment_before_initiate_payment', array( $this, 'remove_provider_attribution' ) );
	}

	/** @return bool */
	public static function configured() {
		return '' !== (string) get_option( self::DATASET_OPTION, '' ) && '' !== (string) get_option( self::TOKEN_OPTION, '' );
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
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
		if ( ! $transaction || empty( $transaction->checkout_url ) ) {
			return;
		}
		$this->enqueue_transaction( $transaction, 'InitiateCheckout' );
	}

	/** @param object $payment Provider payment. @param object $transaction Transaction. */
	public function payment_paid( $payment, $transaction ) {
		unset( $payment );
		$fresh = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $transaction->id );
		if ( ! $fresh || 0 !== (int) $fresh->testmode || 'paid' !== (string) $fresh->status ) {
			return;
		}
		$this->enqueue_transaction( $fresh, 'Purchase' );
	}

	/** @param object $transaction Transaction. @param string $event_name Event name. @return bool */
	public function enqueue_transaction( $transaction, $event_name ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( ! self::configured() || 0 !== (int) $transaction->testmode || ! is_array( $metadata ) || 'fair-events-get-tickets' !== ( $metadata['source'] ?? '' ) || empty( $metadata['meta_consent'] ) || ( empty( $metadata['meta_fbp'] ) && empty( $metadata['meta_fbc'] ) ) ) {
			return false;
		}
		$time  = 'InitiateCheckout' === $event_name && ! empty( $transaction->payment_initiated_at ) ? strtotime( $transaction->payment_initiated_at . ' UTC' ) : strtotime( $transaction->updated_at . ' UTC' );
		$event = array(
			'transaction_id' => (int) $transaction->id,
			'event_name'     => $event_name,
			'event_id'       => self::event_id( (int) $transaction->id, $event_name ),
			'event_time'     => $time ? $time : time(),
			'source_url'     => esc_url_raw( $metadata['meta_source_url'] ?? '' ),
			'value'          => (float) $transaction->amount,
			'currency'       => strtoupper( sanitize_key( $transaction->currency ) ),
			'order_id'       => 'Purchase' === $event_name ? (string) $transaction->id : '',
			'fbp'            => self::valid_identifier( $metadata['meta_fbp'] ?? '' ) ? $metadata['meta_fbp'] : '',
			'fbc'            => self::valid_identifier( $metadata['meta_fbc'] ?? '' ) ? $metadata['meta_fbc'] : '',
		);
		if ( '' === $event['fbp'] && '' === $event['fbc'] ) {
			return false;
		}
		$inserted = ( new Outbox() )->enqueue( $event );
		if ( $inserted && ! wp_next_scheduled( self::DELIVERY_HOOK ) ) {
			wp_schedule_single_event( time() + 1, self::DELIVERY_HOOK );
		}
		return $inserted;
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
				'fbp' => $row->fbp,
				'fbc' => $row->fbc,
			)
		);
		$custom    = array(
			'value'    => (float) $row->value,
			'currency' => $row->currency,
		);
		if ( '' !== $row->order_id ) {
			$custom['order_id'] = $row->order_id;
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

	/** Deliver queued rows without affecting payment state. */
	public function deliver_due() {
		$outbox = new Outbox();
		$row    = $outbox->claim_due();
		while ( $row ) {
			$result = $this->send_payload( self::payload_for( $row ) );
			if ( $result['accepted'] ) {
				$outbox->finish( (int) $row->id, 'accepted' );
			} elseif ( $result['temporary'] ) {
				$outbox->retry( $row, $result['code'], $result['type'] );
			} else {
				$outbox->finish( (int) $row->id, 'configuration_error', $result['code'], $result['type'] );
			}
			$row = $outbox->claim_due();
		}
	}

	/** @param array $event Event. @param string $test_code Optional explicit test code. @return array */
	public function send_payload( $event, $test_code = '' ) {
		$dataset = (string) get_option( self::DATASET_OPTION, '' );
		$token   = (string) get_option( self::TOKEN_OPTION, '' );
		if ( '' === $dataset || '' === $token ) {
			return array(
				'accepted'  => false,
				'temporary' => false,
				'code'      => 'missing_configuration',
				'type'      => 'configuration',
			);
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
				'timeout' => 10,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return array(
				'accepted'  => false,
				'temporary' => true,
				'code'      => 'network',
				'type'      => 'transport',
			);
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		$data   = json_decode( wp_remote_retrieve_body( $response ), true );
		$code   = sanitize_key( (string) ( $data['error']['code'] ?? $status ) );
		$type   = sanitize_key( (string) ( $data['error']['type'] ?? 'http' ) );
		return array(
			'accepted'  => $status >= 200 && $status < 300,
			'temporary' => 408 === $status || 429 === $status || $status >= 500,
			'code'      => $code,
			'type'      => $type,
		);
	}

	/** @return array */
	public function send_test() {
		$code = (string) get_option( self::TEST_CODE_OPTION, '' );
		if ( '' === $code ) {
			return array(
				'accepted'  => false,
				'temporary' => false,
				'code'      => 'missing_test_code',
				'type'      => 'configuration',
			);
		}
		$event = array(
			'event_name'       => 'PageView',
			'event_time'       => time(),
			'event_id'         => wp_generate_uuid4(),
			'action_source'    => 'website',
			'event_source_url' => home_url( '/' ),
			'user_data'        => array( 'external_id' => array( hash( 'sha256', wp_generate_uuid4() ) ) ),
			'custom_data'      => array(),
		);
		return $this->send_payload( $event, $code );
	}

	/** Purge retained delivery rows. */
	public function cleanup() {
		( new Outbox() )->cleanup(); }
}
