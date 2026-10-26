<?php
/**
 * Per-IP rate limits for the public payment endpoints.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

defined( 'WPINC' ) || die;

use WP_Error;

/**
 * Fixed-window, per-IP request counters for the anonymous payment, nonce and
 * webhook routes, kept in transients.
 *
 * Each bucket has its own budget, so one route cannot use up another's. A
 * window starts with the first counted request and ends a fixed time later;
 * later requests never extend it. Increments are not atomic, so concurrent
 * requests can exceed a limit slightly.
 *
 * The client is identified by REMOTE_ADDR only. Forwarded headers are ignored because
 * any caller can set them; a site behind a reverse proxy should configure the
 * server to pass the real client address.
 */
class PublicEndpointRateLimiter {

	/**
	 * Payment creation attempts.
	 */
	const BUCKET_PAYMENT = 'payment';

	/**
	 * Payment form nonce requests.
	 */
	const BUCKET_NONCE = 'nonce';

	/**
	 * Webhook requests with a missing, malformed or unknown payment ID.
	 */
	const BUCKET_INVALID_WEBHOOK = 'invalid_webhook';

	/**
	 * Requests allowed per window and window length in seconds, by bucket.
	 */
	const LIMITS = array(
		self::BUCKET_PAYMENT         => array(
			'max'    => 10,
			'window' => 60,
		),
		self::BUCKET_NONCE           => array(
			'max'    => 60,
			'window' => 60,
		),
		self::BUCKET_INVALID_WEBHOOK => array(
			'max'    => 30,
			'window' => 60,
		),
	);

	/**
	 * Client identifier used when REMOTE_ADDR is missing or not an IP address.
	 */
	const UNKNOWN_CLIENT = 'unknown';

	/**
	 * Transient key prefix.
	 */
	const KEY_PREFIX = 'fpc_rl_';

	/**
	 * Returns the current Unix time.
	 *
	 * @var callable
	 */
	private $clock;

	/**
	 * Constructor.
	 *
	 * @param callable|null $clock Returns the current Unix time; defaults to time().
	 */
	public function __construct( $clock = null ) {
		$this->clock = $clock ? $clock : 'time';
	}

	/**
	 * Count a request against a bucket, unless the bucket is already full.
	 *
	 * @param string $bucket One of the BUCKET_* constants.
	 * @return WP_Error|null A 429 error when the limit is reached, null when the request may proceed.
	 */
	public function attempt( $bucket ) {
		$limited = $this->check( $bucket );
		if ( $limited ) {
			return $limited;
		}

		$this->record( $bucket );
		return null;
	}

	/**
	 * Check whether the current client has used up a bucket, without counting.
	 *
	 * @param string $bucket One of the BUCKET_* constants.
	 * @return WP_Error|null A 429 error when the limit is reached, null otherwise.
	 */
	public function check( $bucket ) {
		$window = $this->current_window( $bucket );
		if ( ! $window || $window['count'] < self::LIMITS[ $bucket ]['max'] ) {
			return null;
		}

		return self::limited_error( $window['expires'] - $this->now() );
	}

	/**
	 * Count a request against a bucket. Starts a new window when none is open.
	 *
	 * @param string $bucket One of the BUCKET_* constants.
	 * @return void
	 */
	public function record( $bucket ) {
		$now    = $this->now();
		$window = $this->current_window( $bucket );

		if ( $window ) {
			$window['count'] = $window['count'] + 1;
		} else {
			$window = array(
				'count'   => 1,
				'expires' => $now + self::LIMITS[ $bucket ]['window'],
			);
		}

		// Expire the transient with the window, never later.
		set_transient( self::key( $bucket, self::client_ip() ), $window, max( 1, $window['expires'] - $now ) );
	}

	/**
	 * The open window of a bucket for the current client.
	 *
	 * @param string $bucket One of the BUCKET_* constants.
	 * @return array|null { count, expires } or null when no window is open.
	 */
	private function current_window( $bucket ) {
		$stored = get_transient( self::key( $bucket, self::client_ip() ) );

		if ( ! is_array( $stored ) || ! isset( $stored['count'], $stored['expires'] ) ) {
			return null;
		}

		if ( (int) $stored['expires'] <= $this->now() ) {
			return null;
		}

		return array(
			'count'   => (int) $stored['count'],
			'expires' => (int) $stored['expires'],
		);
	}

	/**
	 * Current Unix time.
	 *
	 * @return int
	 */
	private function now() {
		return (int) call_user_func( $this->clock );
	}

	/**
	 * Transient key of a bucket for a client. The address is hashed so it is
	 * not stored in the options table.
	 *
	 * @param string $bucket    One of the BUCKET_* constants.
	 * @param string $client_ip Normalized client identifier, from client_ip().
	 * @return string
	 */
	public static function key( $bucket, $client_ip ) {
		return self::KEY_PREFIX . $bucket . '_' . md5( $client_ip );
	}

	/**
	 * The current client's normalized IP address, or UNKNOWN_CLIENT when
	 * REMOTE_ADDR is missing or not a valid address.
	 *
	 * Normalizing gives each address one spelling, so "2001:DB8::1" and
	 * "2001:db8:0:0:0:0:0:1" share a counter.
	 *
	 * @return string
	 */
	public static function client_ip() {
		if ( empty( $_SERVER['REMOTE_ADDR'] ) || ! is_string( $_SERVER['REMOTE_ADDR'] ) ) {
			return self::UNKNOWN_CLIENT;
		}

		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotValidated, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
		$address = trim( sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) );

		if ( false === filter_var( $address, FILTER_VALIDATE_IP ) ) {
			return self::UNKNOWN_CLIENT;
		}

		$packed = inet_pton( $address );
		$normal = false === $packed ? false : inet_ntop( $packed );

		return false === $normal ? self::UNKNOWN_CLIENT : $normal;
	}

	/**
	 * The 429 error returned once a limit is reached.
	 *
	 * @param int $retry_after Seconds until the window ends.
	 * @return WP_Error
	 */
	private static function limited_error( $retry_after ) {
		$retry_after = max( 1, (int) $retry_after );

		return new WP_Error(
			'rate_limited',
			sprintf(
				/* translators: %d: number of seconds to wait */
				_n(
					'Too many requests. Please try again in %d second.',
					'Too many requests. Please try again in %d seconds.',
					$retry_after,
					'fair-payments-connector'
				),
				$retry_after
			),
			array(
				'status'      => 429,
				'retry_after' => $retry_after,
			)
		);
	}
}
