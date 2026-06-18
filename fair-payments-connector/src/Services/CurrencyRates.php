<?php
/**
 * Currency conversion rates for Fair Payments Connector.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

defined( 'WPINC' ) || die;

/**
 * Hardcoded EUR-based exchange rates.
 *
 * Each value is the number of that currency per 1 EUR.
 * EUR itself is omitted (rate = 1.0).
 */
class CurrencyRates {

	/**
	 * Exchange rates: how many units of each currency equal 1 EUR.
	 *
	 * @var array<string,float>
	 */
	const EUR_RATES = array(
		'USD' => 1.1,
		'GBP' => 0.85,
		'CHF' => 0.95,
		'DKK' => 0.746,
		'NOK' => 12.0,
		'SEK' => 11.0,
		'PLN' => 4.25,
		'CZK' => 25.0,
		'HUF' => 400.0,
	);

	/**
	 * Convert an amount expressed in EUR to the given currency.
	 *
	 * Returns the original EUR amount unchanged when no rate is defined for
	 * the target currency (e.g. EUR itself, or any currency added in future
	 * without a corresponding rate entry).
	 *
	 * @param float  $eur_amount Amount in EUR.
	 * @param string $currency   Target ISO 4217 currency code.
	 * @return float Converted amount.
	 */
	public static function from_eur( float $eur_amount, string $currency ): float {
		$rate = self::EUR_RATES[ strtoupper( $currency ) ] ?? 1.0;
		return $eur_amount * $rate;
	}
}
