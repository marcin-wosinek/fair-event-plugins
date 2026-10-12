<?php
/**
 * Settlement movement identity, hashing, totals and cross-source comparison
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settlements;

defined( 'WPINC' ) || die;

/**
 * Pure rules shared by the API and CSV importers.
 *
 * A movement is one row of a settlement: a payment, capture, refund,
 * chargeback, fee or adjustment. Detail movements carry an external
 * reference; aggregate rows (summed costs, report summaries) do not, so they
 * are never matched across sources or added to detail movements.
 */
class Movements {

	const TYPE_PAYMENT    = 'payment';
	const TYPE_CAPTURE    = 'capture';
	const TYPE_REFUND     = 'refund';
	const TYPE_CHARGEBACK = 'chargeback';
	const TYPE_FEE        = 'fee';
	const TYPE_ADJUSTMENT = 'adjustment';
	const TYPE_SUMMARY    = 'summary';
	const TYPE_UNKNOWN    = 'unknown';

	const SOURCE_API = 'api';
	const SOURCE_CSV = 'csv';

	/**
	 * Movement types in display order.
	 *
	 * @return string[]
	 */
	public static function types() {
		return array(
			self::TYPE_PAYMENT,
			self::TYPE_CAPTURE,
			self::TYPE_REFUND,
			self::TYPE_CHARGEBACK,
			self::TYPE_FEE,
			self::TYPE_ADJUSTMENT,
			self::TYPE_SUMMARY,
			self::TYPE_UNKNOWN,
		);
	}

	/**
	 * Fill in a movement's defaults.
	 *
	 * @param array $movement Partial movement.
	 * @return array
	 */
	public static function make( array $movement ) {
		return array_merge(
			array(
				'type'                => self::TYPE_UNKNOWN,
				'is_aggregate'        => false,
				'external_id'         => null,
				'payment_reference'   => null,
				'occurrence'          => 1,
				'identity_key'        => '',
				'amount'              => null,
				'currency'            => null,
				'settlement_amount'   => null,
				'settlement_currency' => null,
				'description'         => '',
				'provider_status'     => null,
				'occurred_at'         => null,
				'needs_review'        => false,
				'raw_type'            => null,
				'report'              => null,
			),
			$movement
		);
	}

	/**
	 * Give every movement an identity that is stable across imports.
	 *
	 * A detail movement is identified by its type and external reference; a
	 * row without one by its type and content. Rows that repeat within one
	 * source keep their own identity through an occurrence number, so two
	 * legitimate identical rows are neither merged nor dropped.
	 *
	 * @param array[] $movements Movements in source order.
	 * @return array[]
	 */
	public static function assign_identities( array $movements ) {
		$seen = array();

		foreach ( $movements as $index => $movement ) {
			$base                     = self::identity_base( $movement );
			$seen[ $base ]            = ( $seen[ $base ] ?? 0 ) + 1;
			$movement['occurrence']   = $seen[ $base ];
			$movement['identity_key'] = $base . '#' . $seen[ $base ];
			$movements[ $index ]      = $movement;
		}

		return $movements;
	}

	/**
	 * Identity of a movement before its occurrence number.
	 *
	 * @param array $movement Movement.
	 * @return string
	 */
	public static function identity_base( array $movement ) {
		if ( ! $movement['is_aggregate'] && null !== $movement['external_id'] && '' !== $movement['external_id'] ) {
			return $movement['type'] . ':' . $movement['external_id'];
		}

		if ( ! empty( $movement['report'] ) ) {
			// A report line is identified by its details, with one spelling per
			// amount, so a refresh that only respells a decimal is the same line.
			$content = array( strtolower( trim( (string) $movement['description'] ) ), Report::material( $movement['report'] ) );

			return 'agg:' . $movement['type'] . ':' . md5( (string) wp_json_encode( $content ) );
		}

		$content = array(
			strtolower( trim( (string) $movement['description'] ) ),
			(string) $movement['raw_type'],
			(string) $movement['amount'],
			(string) $movement['currency'],
			(string) $movement['settlement_amount'],
			(string) $movement['settlement_currency'],
		);

		return ( $movement['is_aggregate'] ? 'agg:' : 'row:' ) . $movement['type'] . ':' . md5( implode( '|', $content ) );
	}

	/**
	 * Whether a movement can be matched to the same movement from another source.
	 *
	 * @param array $movement Movement.
	 * @return bool
	 */
	public static function has_established_identity( array $movement ) {
		return ! $movement['is_aggregate'] && null !== $movement['external_id'] && '' !== $movement['external_id'];
	}

	/**
	 * Hash of everything that matters financially in one source's view of a
	 * settlement. Two imports with the same hash describe the same facts.
	 *
	 * Rows without report details hash exactly as they did before report
	 * details were kept, so earlier revisions keep their hashes.
	 *
	 * @param array   $facts     Settlement facts.
	 * @param array[] $movements Movements with identities.
	 * @return string
	 */
	public static function content_hash( array $facts, array $movements ) {
		$material = array();
		foreach ( $movements as $movement ) {
			$row = array(
				$movement['type'],
				(bool) $movement['is_aggregate'],
				$movement['external_id'],
				$movement['amount'],
				$movement['currency'],
				$movement['settlement_amount'],
				$movement['settlement_currency'],
				$movement['provider_status'],
			);

			if ( ! empty( $movement['report'] ) ) {
				// The report details stand in for the amount, spelled one way.
				$row[5] = null;
				$row[]  = Report::material( $movement['report'] );
			}

			$material[ $movement['identity_key'] ] = $row;
		}
		ksort( $material );

		$header = array();
		foreach ( array( 'provider_id', 'reference', 'currency', 'amount', 'status', 'settled_at' ) as $field ) {
			$header[ $field ] = $facts[ $field ] ?? null;
		}

		return hash( 'sha256', (string) wp_json_encode( array( $header, $material ) ) );
	}

	/**
	 * Totals of one source's movements, per type.
	 *
	 * Detail movements and aggregate rows are totalled separately: a summed
	 * cost row may describe the same money as detail rows, so the two are
	 * never added together. A total is null when it cannot be stated exactly
	 * (an unknown amount, or more than one currency).
	 *
	 * @param array[] $movements Movements.
	 * @return array
	 */
	public static function totals( array $movements ) {
		$by_type = array();
		$groups  = array(
			'detail'    => array(),
			'aggregate' => array(),
		);

		// A payment settled through its captures is the same money as those
		// captures, so it is left out of the detail total.
		$captured = array();
		foreach ( $movements as $movement ) {
			if ( self::TYPE_CAPTURE === $movement['type'] && null !== $movement['payment_reference'] ) {
				$captured[ $movement['payment_reference'] ] = true;
			}
		}
		$settled_by_captures = 0;

		foreach ( $movements as $movement ) {
			$type = $movement['type'];
			if ( ! isset( $by_type[ $type ] ) ) {
				$by_type[ $type ] = array();
			}
			$by_type[ $type ][] = $movement;

			if ( self::TYPE_SUMMARY === $type ) {
				continue;
			}
			if ( self::TYPE_PAYMENT === $type && isset( $captured[ (string) $movement['external_id'] ] ) ) {
				++$settled_by_captures;
				continue;
			}
			$groups[ $movement['is_aggregate'] ? 'aggregate' : 'detail' ][] = $movement;
		}

		$totals = array( 'by_type' => array() );
		foreach ( self::types() as $type ) {
			if ( isset( $by_type[ $type ] ) ) {
				$totals['by_type'][ $type ] = self::total_of( $by_type[ $type ] );
			}
		}
		$totals['detail']    = self::total_of( $groups['detail'] );
		$totals['aggregate'] = self::total_of( $groups['aggregate'] );

		$totals['payments_settled_by_captures'] = $settled_by_captures;

		return $totals;
	}

	/**
	 * Exact settlement-amount total of a list of movements.
	 *
	 * @param array[] $movements Movements.
	 * @return array{count: int, unknown: int, currency: string|null, settlement_amount: string|null}
	 */
	private static function total_of( array $movements ) {
		$values     = array();
		$currencies = array();
		$unknown    = 0;

		foreach ( $movements as $movement ) {
			if ( null === $movement['settlement_amount'] ) {
				++$unknown;
				continue;
			}
			$values[] = $movement['settlement_amount'];
			$currencies[ (string) $movement['settlement_currency'] ] = true;
		}

		$currency = 1 === count( $currencies ) ? (string) array_key_first( $currencies ) : null;
		$currency = '' === $currency ? null : $currency;
		$exact    = 0 === $unknown && count( $currencies ) <= 1 && ! empty( $values );

		return array(
			'count'             => count( $movements ),
			'unknown'           => $unknown,
			'currency'          => $currency,
			// Report lines can carry more decimals than the currency has minor units.
			'settlement_amount' => $exact ? ReportDecimal::sum( $values ) : null,
		);
	}

	/**
	 * Combine the API and CSV views of one settlement without adding them.
	 *
	 * Movements with an established identity that both sources report become
	 * one row listing both sources; differing values are kept side by side
	 * as a conflict, with the API value shown as the accepted one. Everything
	 * else stays a separate row labelled with its single source.
	 *
	 * @param array[] $api Movements from the published API revision.
	 * @param array[] $csv Movements from the published CSV revision.
	 * @return array[]
	 */
	public static function merge( array $api, array $csv ) {
		$merged = array();
		$by_key = array();

		foreach ( $api as $movement ) {
			$movement['sources']  = array( self::SOURCE_API );
			$movement['conflict'] = null;
			$merged[]             = $movement;
			if ( self::has_established_identity( $movement ) ) {
				$by_key[ $movement['identity_key'] ] = count( $merged ) - 1;
			}
		}

		foreach ( $csv as $movement ) {
			$key = $movement['identity_key'];
			if ( self::has_established_identity( $movement ) && isset( $by_key[ $key ] ) ) {
				$index                        = $by_key[ $key ];
				$merged[ $index ]['sources']  = array( self::SOURCE_API, self::SOURCE_CSV );
				$merged[ $index ]['conflict'] = self::value_conflict( $merged[ $index ], $movement );
				continue;
			}

			$movement['sources']  = array( self::SOURCE_CSV );
			$movement['conflict'] = null;
			$merged[]             = $movement;
		}

		return $merged;
	}

	/**
	 * Values two sources disagree on for the same movement.
	 *
	 * A value one source does not know is not a disagreement.
	 *
	 * @param array $api API movement.
	 * @param array $csv CSV movement.
	 * @return array|null Differing fields as `field => [api, csv]`, or null.
	 */
	private static function value_conflict( array $api, array $csv ) {
		$differences = array();

		foreach ( array( 'currency', 'settlement_currency' ) as $field ) {
			if ( null !== $api[ $field ] && null !== $csv[ $field ] && $api[ $field ] !== $csv[ $field ] ) {
				$differences[ $field ] = array(
					self::SOURCE_API => $api[ $field ],
					self::SOURCE_CSV => $csv[ $field ],
				);
			}
		}

		$amounts = array(
			'amount'            => 'currency',
			'settlement_amount' => 'settlement_currency',
		);
		foreach ( $amounts as $field => $currency_field ) {
			if ( null === $api[ $field ] || null === $csv[ $field ] || isset( $differences[ $currency_field ] ) ) {
				continue;
			}
			$currency = $api[ $currency_field ] ?? $csv[ $currency_field ];
			if ( ! Decimal::equals( $api[ $field ], $csv[ $field ], $currency ) ) {
				$differences[ $field ] = array(
					self::SOURCE_API => $api[ $field ],
					self::SOURCE_CSV => $csv[ $field ],
				);
			}
		}

		return empty( $differences ) ? null : $differences;
	}

	/**
	 * What changed between two versions of the same source.
	 *
	 * @param array[] $accepted Movements of the accepted revision.
	 * @param array[] $proposed Movements of the proposed revision.
	 * @return array{added: array[], removed: array[], changed: array[]}
	 */
	public static function diff( array $accepted, array $proposed ) {
		$accepted_by_key = array();
		foreach ( $accepted as $movement ) {
			$accepted_by_key[ $movement['identity_key'] ] = $movement;
		}

		$added   = array();
		$changed = array();
		foreach ( $proposed as $movement ) {
			$key = $movement['identity_key'];
			if ( ! isset( $accepted_by_key[ $key ] ) ) {
				$added[] = $movement;
				continue;
			}

			$before = $accepted_by_key[ $key ];
			unset( $accepted_by_key[ $key ] );

			$fields = array();
			foreach ( array( 'amount', 'currency', 'settlement_amount', 'settlement_currency', 'provider_status' ) as $field ) {
				if ( $before[ $field ] !== $movement[ $field ] ) {
					$fields[ $field ] = array(
						'accepted' => $before[ $field ],
						'proposed' => $movement[ $field ],
					);
				}
			}
			if ( ! empty( $fields ) ) {
				$changed[] = array(
					'identity_key' => $key,
					'type'         => $movement['type'],
					'external_id'  => $movement['external_id'],
					'description'  => $movement['description'],
					'fields'       => $fields,
				);
			}
		}

		return array(
			'added'   => $added,
			'removed' => array_values( $accepted_by_key ),
			'changed' => $changed,
		);
	}
}
