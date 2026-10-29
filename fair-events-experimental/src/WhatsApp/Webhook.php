<?php
/**
 * WhatsApp webhook authentication and parsing.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Checks Meta's `X-Hub-Signature-256` header and reduces a callback to the
 * normalized status updates and incoming messages of the configured account.
 *
 * Entries for another WhatsApp Business Account, changes for another phone
 * number and unsupported fields are counted as ignored, never applied.
 * Only allowlisted fields leave this class; incoming message text is passed
 * on but never stored or logged.
 */
class Webhook {
	/** Hook that receives authenticated incoming messages. */
	public const INCOMING_HOOK = 'fair_events_experimental_whatsapp_incoming_message';

	/** Largest callback body accepted, in bytes. */
	public const MAX_BYTES = 1048576;

	/** Longest incoming text passed to the hook. */
	private const MAX_TEXT = 4096;

	/**
	 * Whether the signature header is the App Secret's HMAC of the exact raw
	 * body, compared in constant time.
	 *
	 * @param string $raw    Raw request body.
	 * @param mixed  $header `X-Hub-Signature-256` value, `sha256=<hex>`.
	 * @param string $secret App Secret.
	 * @return bool
	 */
	public static function valid_signature( $raw, $header, $secret ) {
		if ( '' === $secret || ! is_string( $header ) || ! preg_match( '/^sha256=([a-f0-9]{64})$/i', trim( $header ), $match ) ) {
			return false;
		}
		return hash_equals( hash_hmac( 'sha256', (string) $raw, $secret ), strtolower( $match[1] ) );
	}

	/**
	 * The status updates and incoming messages for the configured account.
	 *
	 * @param mixed  $payload         Decoded callback body.
	 * @param string $waba_id         Configured WhatsApp Business Account ID.
	 * @param string $phone_number_id Configured Phone Number ID.
	 * @return array|null `matched` and `ignored` change counts, `statuses`
	 *     and `messages`; null when it is not a WhatsApp callback.
	 */
	public static function parse( $payload, $waba_id, $phone_number_id ) {
		if (
			! is_array( $payload )
			|| 'whatsapp_business_account' !== ( $payload['object'] ?? null )
			|| ! is_array( $payload['entry'] ?? null )
		) {
			return null;
		}

		$result = array(
			'matched'  => 0,
			'ignored'  => 0,
			'statuses' => array(),
			'messages' => array(),
		);
		foreach ( $payload['entry'] as $entry ) {
			$changes = is_array( $entry ) && is_array( $entry['changes'] ?? null ) ? $entry['changes'] : array();
			if ( '' === $waba_id || ! is_array( $entry ) || (string) ( $entry['id'] ?? '' ) !== $waba_id ) {
				$result['ignored'] += max( 1, count( $changes ) );
				continue;
			}
			foreach ( $changes as $change ) {
				$value = is_array( $change ) && is_array( $change['value'] ?? null ) ? $change['value'] : array();
				if (
					'messages' !== ( $change['field'] ?? null )
					|| '' === $phone_number_id
					|| (string) ( $value['metadata']['phone_number_id'] ?? '' ) !== $phone_number_id
				) {
					++$result['ignored'];
					continue;
				}
				++$result['matched'];
				foreach ( is_array( $value['statuses'] ?? null ) ? $value['statuses'] : array() as $status ) {
					$status = self::status( $status );
					if ( $status ) {
						$result['statuses'][] = $status;
					}
				}
				foreach ( is_array( $value['messages'] ?? null ) ? $value['messages'] : array() as $message ) {
					$message = self::message( $message, $waba_id, $phone_number_id );
					if ( $message ) {
						$result['messages'][] = $message;
					}
				}
			}
		}
		return $result;
	}

	/**
	 * A status update reduced to its message ID, status, time and failure
	 * code, or null when it is not one this plugin tracks.
	 *
	 * @param mixed $status One entry of `statuses`.
	 * @return array|null
	 */
	private static function status( $status ) {
		if (
			! is_array( $status )
			|| ! Client::valid_message_id( $status['id'] ?? null )
			|| ! in_array( $status['status'] ?? null, array( 'sent', 'delivered', 'read', 'failed' ), true )
		) {
			return null;
		}
		$code = $status['errors'][0]['code'] ?? null;
		return array(
			'message_id'   => $status['id'],
			'status'       => $status['status'],
			'timestamp'    => self::timestamp( $status['timestamp'] ?? null ),
			'failure_code' => is_numeric( $code ) ? (int) $code : null,
		);
	}

	/**
	 * An incoming message reduced to what an opt-out handler needs.
	 *
	 * @param mixed  $message         One entry of `messages`.
	 * @param string $waba_id         Account it arrived for.
	 * @param string $phone_number_id Number it arrived at.
	 * @return array|null
	 */
	private static function message( $message, $waba_id, $phone_number_id ) {
		if (
			! is_array( $message )
			|| ! Client::valid_message_id( $message['id'] ?? null )
			|| ! is_string( $message['from'] ?? null )
			|| ! preg_match( '/^\d{6,20}$/', $message['from'] )
		) {
			return null;
		}
		$type = is_string( $message['type'] ?? null ) && preg_match( '/^[a-z_]{1,32}$/', $message['type'] ) ? $message['type'] : 'unknown';
		$text = null;
		if ( 'text' === $type && is_string( $message['text']['body'] ?? null ) ) {
			$text = mb_substr( $message['text']['body'], 0, self::MAX_TEXT );
		} elseif ( 'button' === $type && is_string( $message['button']['text'] ?? null ) ) {
			$text = mb_substr( $message['button']['text'], 0, self::MAX_TEXT );
		}
		return array(
			'id'              => $message['id'],
			'from'            => $message['from'],
			'timestamp'       => self::timestamp( $message['timestamp'] ?? null ),
			'type'            => $type,
			'text'            => $text,
			'waba_id'         => $waba_id,
			'phone_number_id' => $phone_number_id,
		);
	}

	/**
	 * Meta's Unix timestamp, or 0.
	 *
	 * @param mixed $value Timestamp, usually a numeric string.
	 * @return int
	 */
	private static function timestamp( $value ) {
		return is_numeric( $value ) && (int) $value > 0 ? (int) $value : 0;
	}
}
