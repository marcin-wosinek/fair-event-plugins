<?php
/**
 * Money formatting and site-currency accessor shared across Fair Event plugins.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared;

/**
 * Centralizes amount-to-string formatting and the site-currency default.
 */
class Money {

	/**
	 * Currency symbols, keyed by ISO code. Missing keys have no symbol form
	 * and fall back to the display (code) form in format_inline().
	 *
	 * @var array<string, array{symbol: string, position: string}>
	 */
	const SYMBOLS = array(
		'EUR' => array(
			'symbol'   => '€',
			'position' => 'prefix',
		),
		'USD' => array(
			'symbol'   => '$',
			'position' => 'prefix',
		),
		'GBP' => array(
			'symbol'   => '£',
			'position' => 'prefix',
		),
		'PLN' => array(
			'symbol'   => 'zł',
			'position' => 'suffix',
		),
		'CZK' => array(
			'symbol'   => 'Kč',
			'position' => 'suffix',
		),
		'HUF' => array(
			'symbol'   => 'Ft',
			'position' => 'suffix',
		),
	);

	/**
	 * The site's configured default currency (ISO code), falling back to EUR.
	 *
	 * @return string Currency code, e.g. "EUR".
	 */
	public static function site_currency() {
		return get_option( 'fair_payment_currency', 'EUR' );
	}

	/**
	 * Format an amount as the '.'-separated machine value used for Mollie
	 * payloads and data-* attributes (e.g. "12.50").
	 *
	 * @param float $amount Amount to format.
	 * @return string Machine-formatted amount.
	 */
	public static function format_value( $amount ) {
		return number_format( (float) $amount, 2, '.', '' );
	}

	/**
	 * Format an amount with its currency code (e.g. "12.50 EUR"). Used for
	 * emails, Timeline, logs, and the callback banner.
	 *
	 * @param float       $amount   Amount to format.
	 * @param string|null $currency Currency code; defaults to the site currency.
	 * @return string Display-formatted amount.
	 */
	public static function format_display( $amount, $currency = null ) {
		$currency = $currency ?? self::site_currency();
		return number_format_i18n( (float) $amount, 2 ) . ' ' . $currency;
	}

	/**
	 * Format an amount with its currency symbol (e.g. "€12.50", "12.50 zł")
	 * for tight block labels. Currencies with no mapped symbol fall back to
	 * format_display().
	 *
	 * @param float       $amount   Amount to format.
	 * @param string|null $currency Currency code; defaults to the site currency.
	 * @return string Inline-formatted amount.
	 */
	public static function format_inline( $amount, $currency = null ) {
		$currency = $currency ?? self::site_currency();
		$symbol   = self::symbol( $currency );

		if ( null === $symbol ) {
			return self::format_display( $amount, $currency );
		}

		$formatted = number_format_i18n( (float) $amount, 2 );

		if ( 'prefix' === self::SYMBOLS[ $currency ]['position'] ) {
			return $symbol . $formatted;
		}

		return $formatted . ' ' . $symbol;
	}

	/**
	 * Look up the currency symbol for a currency code.
	 *
	 * @param string $currency Currency code, e.g. "EUR".
	 * @return string|null The symbol, or null when the currency has no mapped symbol.
	 */
	public static function symbol( $currency ) {
		return self::SYMBOLS[ $currency ]['symbol'] ?? null;
	}
}
