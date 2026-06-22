<?php
/**
 * Digest summary builder
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Assembles a digest message from a batch of queued notification rows.
 *
 * The summary line lists the transaction count and per-currency totals
 * (e.g. "5 sales · 250.00 EUR, 10.00 USD"), followed by the individual
 * per-transaction bodies separated by blank lines.
 */
class DigestBuilder {

	/**
	 * Build the full digest text from an array of queue row objects.
	 *
	 * Each row must have `rendered_text`, `amount`, and `currency` properties.
	 *
	 * @param object[] $rows Queue rows (objects with rendered_text/amount/currency).
	 * @return string Combined digest message.
	 */
	public function build( array $rows ): string {
		$count  = count( $rows );
		$totals = array();

		foreach ( $rows as $row ) {
			$currency = isset( $row->currency ) ? trim( (string) $row->currency ) : '';
			$amount   = isset( $row->amount ) ? (float) $row->amount : 0.0;

			if ( '' !== $currency ) {
				if ( ! isset( $totals[ $currency ] ) ) {
					$totals[ $currency ] = 0.0;
				}
				$totals[ $currency ] += $amount;
			}
		}

		$summary_parts = array();
		foreach ( $totals as $currency => $total ) {
			$summary_parts[] = number_format( $total, 2, '.', '' ) . ' ' . $currency;
		}

		$summary = $count . ' ' . ( 1 === $count ? 'sale' : 'sales' );
		if ( ! empty( $summary_parts ) ) {
			$summary .= ' · ' . implode( ', ', $summary_parts );
		}

		$bodies = array();
		foreach ( $rows as $row ) {
			if ( isset( $row->rendered_text ) && '' !== (string) $row->rendered_text ) {
				$bodies[] = (string) $row->rendered_text;
			}
		}

		if ( empty( $bodies ) ) {
			return $summary;
		}

		return $summary . "\n\n" . implode( "\n\n---\n\n", $bodies );
	}
}
