<?php
/**
 * Payment link allocation rules
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\SignupPaymentLink;
use FairEventsShared\LineItemTotals;

defined( 'WPINC' ) || die;

/**
 * Validates the links one writer wants to add to a Connector transaction
 * against the links it already has (PAYMENT_HISTORY_MIGRATION.md §5.1).
 * Pure: no database, no WordPress state. PaymentLinks reads the inputs under
 * the transaction's lock and writes what this returns.
 *
 * - Every field is checked: purchase ID, role, attribution, evidence,
 *   amount and currency. Amounts are normalized with LineItemTotals and
 *   compared in whole cents.
 * - A link that already exists with the same allocation and currency is
 *   unchanged: a repeated write is a no-op, and the existing row keeps its
 *   attribution and evidence. One that exists with a different allocation
 *   or currency is a conflict, and the whole set is rejected.
 * - The allocations of a transaction never add up to more than its total.
 */
class PaymentLinkAllocation {

	/**
	 * Largest evidence JSON a TEXT column holds.
	 */
	const MAX_EVIDENCE_BYTES = 65535;

	/**
	 * Check a link set and say what to insert.
	 *
	 * @param array   $links       Links to add. Each: signup_id, role, allocated_amount, attribution,
	 *                             evidence (array with a `type`), optional currency and created_at.
	 * @param array   $transaction Connector transaction: id, amount, currency, created_at.
	 * @param array[] $existing    Rows already stored for the transaction.
	 * @return array{insert: array[], unchanged: array[]}|\WP_Error Rows to insert and links already present, or why the set is refused.
	 */
	public static function prepare( array $links, array $transaction, array $existing ) {
		$transaction_id = (int) ( $transaction['id'] ?? 0 );
		$currency       = strtoupper( (string) ( $transaction['currency'] ?? '' ) );

		if ( $transaction_id <= 0 || ! is_numeric( $transaction['amount'] ?? null ) || (float) $transaction['amount'] < 0 || ! self::is_currency( $currency ) ) {
			return new \WP_Error( 'invalid_payment_transaction', 'The transaction has no valid ID, total or currency.', array( 'transaction_id' => $transaction_id ) );
		}
		if ( ! $links ) {
			return new \WP_Error( 'invalid_payment_link', 'No links were given.', array( 'transaction_id' => $transaction_id ) );
		}

		$existing_by_key = array();
		$allocated_cents = 0;
		foreach ( $existing as $row ) {
			$existing_by_key[ self::key( $row['signup_id'], $row['role'] ) ] = $row;
			$allocated_cents += self::cents( $row['allocated_amount'] );
		}

		$insert    = array();
		$unchanged = array();
		$seen      = array();
		foreach ( array_values( $links ) as $index => $link ) {
			$normalized = self::normalize( $link, $index, $transaction_id, $currency, (string) ( $transaction['created_at'] ?? '' ) );
			if ( is_wp_error( $normalized ) ) {
				return $normalized;
			}

			$key = self::key( $normalized['signup_id'], $normalized['role'] );
			if ( isset( $seen[ $key ] ) ) {
				return new \WP_Error(
					'duplicate_payment_link',
					'The set names the same purchase and role twice.',
					array(
						'transaction_id' => $transaction_id,
						'index'          => $index,
					)
				);
			}
			$seen[ $key ] = true;

			if ( isset( $existing_by_key[ $key ] ) ) {
				$stored = $existing_by_key[ $key ];
				if ( ! LineItemTotals::amounts_match( $stored['allocated_amount'], $normalized['allocated_amount'] )
					|| strtoupper( (string) $stored['currency'] ) !== $normalized['currency']
				) {
					return new \WP_Error(
						'payment_link_conflict',
						'The purchase already has a different link to this transaction.',
						array(
							'transaction_id' => $transaction_id,
							'index'          => $index,
							'existing_id'    => (int) $stored['id'],
						)
					);
				}
				$unchanged[] = $stored;
				continue;
			}

			$allocated_cents += self::cents( $normalized['allocated_amount'] );
			$insert[]         = $normalized;
		}

		if ( $allocated_cents > self::cents( $transaction['amount'] ) ) {
			return new \WP_Error(
				'allocation_exceeds_total',
				'The allocations would add up to more than the transaction total.',
				array(
					'transaction_id' => $transaction_id,
					'allocated'      => $allocated_cents / 100,
					'total'          => LineItemTotals::normalize_amount( $transaction['amount'] ),
				)
			);
		}

		return array(
			'insert'    => $insert,
			'unchanged' => $unchanged,
		);
	}

	/**
	 * Validate and normalize one link.
	 *
	 * @param mixed  $link                 Link as given.
	 * @param int    $index                Position in the set, for errors.
	 * @param int    $transaction_id       Transaction ID.
	 * @param string $currency             Transaction currency.
	 * @param string $transaction_created  Transaction creation time.
	 * @return array|\WP_Error Normalized row or the first problem found.
	 */
	private static function normalize( $link, $index, $transaction_id, $currency, $transaction_created ) {
		$invalid = static function ( $field, $message ) use ( $index, $transaction_id ) {
			return new \WP_Error(
				'invalid_payment_link',
				$message,
				array(
					'transaction_id' => $transaction_id,
					'index'          => $index,
					'field'          => $field,
				)
			);
		};

		if ( ! is_array( $link ) ) {
			return $invalid( 'link', 'Each link must be an object.' );
		}

		$signup_id    = $link['signup_id'] ?? null;
		$integer_like = is_int( $signup_id ) || ( is_string( $signup_id ) && ctype_digit( $signup_id ) );
		if ( ! $integer_like || (int) $signup_id <= 0 ) {
			return $invalid( 'signup_id', 'The purchase ID must be a positive integer.' );
		}

		$role = $link['role'] ?? null;
		if ( ! in_array( $role, SignupPaymentLink::roles(), true ) ) {
			return $invalid( 'role', 'Unknown link role.' );
		}

		$attribution = $link['attribution'] ?? null;
		if ( ! in_array( $attribution, SignupPaymentLink::attributions(), true ) ) {
			return $invalid( 'attribution', 'Unknown link attribution.' );
		}

		$amount = $link['allocated_amount'] ?? null;
		if ( ! is_numeric( $amount ) || ! is_finite( (float) $amount ) || (float) $amount < 0 ) {
			return $invalid( 'allocated_amount', 'The allocation must be a number of at least 0.' );
		}

		if ( isset( $link['currency'] ) && strtoupper( (string) $link['currency'] ) !== $currency ) {
			return $invalid( 'currency', 'A link keeps its transaction\'s currency.' );
		}

		$evidence = $link['evidence'] ?? null;
		if ( ! is_array( $evidence ) || ! is_string( $evidence['type'] ?? null ) || ! preg_match( '/^[a-z][a-z0-9_]{0,63}$/', $evidence['type'] ) ) {
			return $invalid( 'evidence', 'Evidence must say which rule established the link.' );
		}
		$evidence_json = wp_json_encode( $evidence );
		if ( ! is_string( $evidence_json ) || strlen( $evidence_json ) > self::MAX_EVIDENCE_BYTES ) {
			return $invalid( 'evidence', 'Evidence must be JSON of at most 64 KB.' );
		}

		$created_at = isset( $link['created_at'] ) ? (string) $link['created_at'] : $transaction_created;
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $created_at ) ) {
			return $invalid( 'created_at', 'The attempt time must be a Y-m-d H:i:s datetime.' );
		}

		return array(
			'signup_id'        => (int) $signup_id,
			'transaction_id'   => $transaction_id,
			'role'             => $role,
			'allocated_amount' => LineItemTotals::normalize_amount( $amount ),
			'currency'         => $currency,
			'attribution'      => $attribution,
			'evidence'         => $evidence_json,
			'created_at'       => $created_at,
		);
	}

	/**
	 * Whether a value is a three-letter currency code.
	 *
	 * @param string $currency Upper-cased code.
	 * @return bool
	 */
	private static function is_currency( $currency ) {
		return 1 === preg_match( '/^[A-Z]{3}$/', $currency );
	}

	/**
	 * A normalized amount in whole cents.
	 *
	 * @param float|int|string $amount Amount.
	 * @return int
	 */
	private static function cents( $amount ) {
		return (int) round( LineItemTotals::normalize_amount( $amount ) * 100 );
	}

	/**
	 * Identity of a link within one transaction.
	 *
	 * @param int|string $signup_id Signup ID.
	 * @param string     $role      Role.
	 * @return string
	 */
	private static function key( $signup_id, $role ) {
		return (int) $signup_id . ':' . (string) $role;
	}
}
