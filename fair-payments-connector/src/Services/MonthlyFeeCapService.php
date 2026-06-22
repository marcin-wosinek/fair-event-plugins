<?php
/**
 * Monthly fee cap service for Fair Payments Connector.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- aggregation query on a custom table; caching not applicable for real-time summaries.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\Schema;
use FairPaymentsConnector\Services\CurrencyRates;

/**
 * Computes the configured monthly fee cap and the current month's accumulated fees.
 */
class MonthlyFeeCapService {

	/**
	 * Return the active-plugin price map in the configured site currency.
	 *
	 * Base prices are defined in EUR and converted using CurrencyRates.
	 * Keys are plugin slugs; values are their contribution to the monthly cap
	 * in the current site currency. fair-payments-connector is always included;
	 * fair-events is added when its bootstrap constant is defined.
	 *
	 * @return array<string,float>
	 */
	public static function plugin_price_map(): array {
		$currency = get_option( 'fair_payment_currency', 'EUR' );

		$prices = array(
			'fair-payments-connector' => CurrencyRates::from_eur( 4.0, $currency ),
		);

		if ( defined( 'FAIR_EVENTS_VERSION' ) ) {
			$prices['fair-events'] = CurrencyRates::from_eur( 8.0, $currency );
		}

		return (array) apply_filters( 'fair_payment_active_plugin_prices', $prices );
	}

	/**
	 * Return the configured monthly cap in the site currency.
	 *
	 * Sums the per-plugin prices for every currently active Fair Event plugin.
	 *
	 * @return float
	 */
	public static function get_cap(): float {
		return (float) array_sum( self::plugin_price_map() );
	}

	/**
	 * Return the sum of application_fee for paid/pending_payment transactions
	 * in the current calendar month, filtered to the current testmode.
	 *
	 * @return float
	 */
	public static function get_month_total(): float {
		global $wpdb;

		$table    = Schema::get_payments_table_name();
		$testmode = 'test' === get_option( 'fair_payment_mode', 'test' ) ? 1 : 0;

		// gmdate() returns UTC; assumes the DB session timezone is also UTC (WordPress default).
		$month_start = gmdate( 'Y-m-01 00:00:00' );
		$month_end   = gmdate( 'Y-m-t 23:59:59' );

		return (float) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT SUM(application_fee) FROM %i WHERE status IN (%s, %s) AND testmode = %d AND created_at BETWEEN %s AND %s',
				$table,
				'paid',
				'pending_payment',
				$testmode,
				$month_start,
				$month_end
			)
		);
	}

	/**
	 * Return the remaining cap for the current month (floored at 0).
	 *
	 * @return float
	 */
	public static function get_remaining(): float {
		return max( 0.0, self::get_cap() - self::get_month_total() );
	}
}
