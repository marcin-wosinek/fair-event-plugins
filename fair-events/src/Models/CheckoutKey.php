<?php
/**
 * Checkout Key Model
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Model for the fair_events_checkout_keys table: the idempotency record of a
 * get-tickets checkout.
 *
 * A key is stored with the signups it created, so a request retried with the
 * same key resolves to that purchase instead of creating another one. The
 * record is written in the same transaction as its signups, under the
 * capacity locks.
 *
 * Finishing a checkout (linking the buyer, creating and starting the
 * payment) happens after that transaction, outside any database lock. The
 * request doing it holds a claim on the record; a retry arriving meanwhile
 * waits for it, and takes the claim over only once it ran out (the first
 * request died), then continues from what was persisted.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class CheckoutKey {

	/**
	 * The checkout is still being finished.
	 */
	const STATE_OPEN = 'open';

	/**
	 * The checkout was finished or ended; the record only reports its
	 * purchase's current state.
	 */
	const STATE_COMPLETED = 'completed';

	/**
	 * How long a request may work on a checkout before another may take it over.
	 */
	const CLAIM_SECONDS = 90;

	/**
	 * How long the key of a purchase that was never confirmed is kept: well
	 * past any payment session, so a delayed retry cannot start a new
	 * checkout. Keys of confirmed purchases are kept for good.
	 */
	const RETENTION_SECONDS = 2592000;

	/**
	 * Table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . 'fair_events_checkout_keys';
	}

	/**
	 * Find the record of an idempotency key.
	 *
	 * @param string $key Idempotency key as submitted.
	 * @return object|null
	 */
	public static function find( string $key ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE key_hash = %s', self::table(), self::hash( $key ) )
		);
	}

	/**
	 * Get a record by ID.
	 *
	 * @param int $id Record ID.
	 * @return object|null
	 */
	public static function get_by_id( int $id ) {
		global $wpdb;

		return $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table(), $id )
		);
	}

	/**
	 * Record a new key, claimed by the request creating it. Call inside the
	 * transaction that saves the checkout's signups: a key another request
	 * recorded first makes this return false, and the caller rolls back.
	 *
	 * @param string $key         Idempotency key as submitted.
	 * @param string $fingerprint Fingerprint of the purchase details.
	 * @param array  $context     What finishing the checkout needs.
	 * @param string $claim_token Claim token of the creating request.
	 * @return int|false Record ID, or false when the key already exists.
	 */
	public static function create( string $key, string $fingerprint, array $context, string $claim_token ) {
		global $wpdb;

		$inserted = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i ( key_hash, fingerprint, state, signup_ids, context, claim_token, claim_expires_at, created_at ) VALUES ( %s, %s, %s, %s, %s, %s, %s, %s )',
				self::table(),
				self::hash( $key ),
				$fingerprint,
				self::STATE_OPEN,
				'',
				wp_json_encode( $context ),
				$claim_token,
				self::new_claim_expiry(),
				gmdate( 'Y-m-d H:i:s' )
			)
		);

		return 1 === (int) $inserted ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Store the signup rows a checkout created.
	 *
	 * @param int   $id         Record ID.
	 * @param int[] $signup_ids Signup row IDs.
	 * @return bool
	 */
	public static function set_signup_ids( int $id, array $signup_ids ) {
		global $wpdb;

		return false !== $wpdb->update(
			self::table(),
			array( 'signup_ids' => implode( ',', array_map( 'intval', $signup_ids ) ) ),
			array( 'id' => $id ),
			array( '%s' ),
			array( '%d' )
		);
	}

	/**
	 * The signup rows a checkout created.
	 *
	 * @param object $record Checkout key row.
	 * @return int[]
	 */
	public static function signup_ids( $record ) {
		return array_values( array_filter( array_map( 'intval', explode( ',', (string) $record->signup_ids ) ) ) );
	}

	/**
	 * What finishing a checkout needs, as stored when it was created.
	 *
	 * @param object $record Checkout key row.
	 * @return array
	 */
	public static function context( $record ) {
		$context = json_decode( (string) $record->context, true );

		return is_array( $context ) ? $context : array();
	}

	/**
	 * Take over an open checkout nobody is working on: one never claimed,
	 * released after an error, or whose claim ran out.
	 *
	 * @param int    $id          Record ID.
	 * @param string $claim_token Claim token of the request taking over.
	 * @return bool True when this request now holds the claim.
	 */
	public static function claim( int $id, string $claim_token ) {
		global $wpdb;

		return 1 === (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET claim_token = %s, claim_expires_at = %s WHERE id = %d AND state = %s AND ( claim_expires_at IS NULL OR claim_expires_at <= %s )',
				self::table(),
				$claim_token,
				self::new_claim_expiry(),
				$id,
				self::STATE_OPEN,
				gmdate( 'Y-m-d H:i:s' )
			)
		);
	}

	/**
	 * Extend a claim this request still holds, before a step that must not
	 * run twice.
	 *
	 * @param int    $id          Record ID.
	 * @param string $claim_token Claim token of this request.
	 * @return bool False when another request took the checkout over.
	 */
	public static function renew_claim( int $id, string $claim_token ) {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET claim_expires_at = %s WHERE id = %d AND state = %s AND claim_token = %s',
				self::table(),
				self::new_claim_expiry(),
				$id,
				self::STATE_OPEN,
				$claim_token
			)
		);

		$record = self::get_by_id( $id );

		return $record && self::STATE_OPEN === $record->state && hash_equals( (string) $record->claim_token, $claim_token );
	}

	/**
	 * Give up a claim so a retry can continue the checkout right away.
	 *
	 * @param int    $id          Record ID.
	 * @param string $claim_token Claim token of this request.
	 * @return void
	 */
	public static function release_claim( int $id, string $claim_token ) {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET claim_token = NULL, claim_expires_at = NULL WHERE id = %d AND claim_token = %s',
				self::table(),
				$id,
				$claim_token
			)
		);
	}

	/**
	 * Record that the checkout's signup hooks ran, so a continued checkout
	 * does not run them again.
	 *
	 * @param int $id Record ID.
	 * @return void
	 */
	public static function mark_hooks_fired( int $id ) {
		global $wpdb;

		$wpdb->update( self::table(), array( 'hooks_fired' => 1 ), array( 'id' => $id ), array( '%d' ), array( '%d' ) );
	}

	/**
	 * Mark a checkout finished or ended.
	 *
	 * @param int $id Record ID.
	 * @return void
	 */
	public static function complete( int $id ) {
		global $wpdb;

		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET state = %s, claim_token = NULL, claim_expires_at = NULL WHERE id = %d',
				self::table(),
				self::STATE_COMPLETED,
				$id
			)
		);
	}

	/**
	 * Delete keys past their retention whose purchase holds no confirmed or
	 * pending signup. A key with a confirmed signup is never deleted.
	 *
	 * @return int Number of records deleted.
	 */
	public static function delete_stale() {
		global $wpdb;

		return (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE k FROM %i AS k
				WHERE k.created_at < %s
				AND NOT EXISTS (
					SELECT 1 FROM %i AS s
					WHERE FIND_IN_SET( s.id, k.signup_ids ) > 0 AND s.status IN ( 'confirmed', 'pending_payment' )
				)",
				self::table(),
				gmdate( 'Y-m-d H:i:s', time() - self::RETENTION_SECONDS ),
				$wpdb->prefix . 'fair_events_signups'
			)
		);
	}

	/**
	 * Hash a submitted key for storage and lookup.
	 *
	 * @param string $key Idempotency key as submitted.
	 * @return string
	 */
	private static function hash( string $key ) {
		return hash( 'sha256', $key );
	}

	/**
	 * Expiry (UTC) of a claim starting now.
	 *
	 * @return string
	 */
	private static function new_claim_expiry() {
		return gmdate( 'Y-m-d H:i:s', time() + self::CLAIM_SECONDS );
	}
}
