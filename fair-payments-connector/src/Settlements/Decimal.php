<?php
/**
 * Exact decimal handling for settlement amounts
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settlements;

defined( 'WPINC' ) || die;

/**
 * Settlement amounts are kept as decimal strings and added in whole minor
 * units, so no value ever passes through a float.
 */
class Decimal {

	/**
	 * Currencies without minor units.
	 */
	const ZERO_DECIMAL = array( 'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' );

	/**
	 * Currencies with three minor-unit digits.
	 */
	const THREE_DECIMAL = array( 'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND' );

	/**
	 * Decimals allowed when the currency is unknown.
	 */
	const UNKNOWN_CURRENCY_DECIMALS = 4;

	/**
	 * Whether a value is a well-formed ISO 4217 style currency code.
	 *
	 * @param mixed $currency Candidate code.
	 * @return bool
	 */
	public static function is_currency( $currency ) {
		return is_string( $currency ) && 1 === preg_match( '/^[A-Z]{3}$/', $currency );
	}

	/**
	 * Minor-unit digits of a currency.
	 *
	 * @param string|null $currency Currency code, or null when unknown.
	 * @return int
	 */
	public static function exponent( $currency ) {
		if ( null === $currency ) {
			return self::UNKNOWN_CURRENCY_DECIMALS;
		}
		if ( in_array( $currency, self::ZERO_DECIMAL, true ) ) {
			return 0;
		}
		if ( in_array( $currency, self::THREE_DECIMAL, true ) ) {
			return 3;
		}
		return 2;
	}

	/**
	 * Turn a raw amount into its canonical decimal string.
	 *
	 * Accepts an optional sign, digits, and one `.` or `,` decimal separator.
	 * Grouping separators, currency symbols and more significant decimals
	 * than the currency has are refused rather than guessed at, so `1,234`
	 * in EUR is invalid instead of becoming 1.23 or 1234.
	 *
	 * @param mixed       $raw      Raw value.
	 * @param string|null $currency Currency code, or null when unknown.
	 * @return string|null Canonical value, or null when it is not a valid amount.
	 */
	public static function normalize( $raw, $currency ) {
		if ( ! is_string( $raw ) && ! is_int( $raw ) ) {
			return null;
		}

		if ( 1 !== preg_match( '/^([+-]?)(\d{1,15})(?:[.,](\d{1,10}))?$/', trim( (string) $raw ), $matches ) ) {
			return null;
		}

		$exponent = self::exponent( $currency );
		$whole    = ltrim( $matches[2], '0' );
		$fraction = $matches[3] ?? '';

		if ( strlen( $fraction ) > $exponent ) {
			if ( '' !== trim( substr( $fraction, $exponent ), '0' ) ) {
				return null;
			}
			$fraction = substr( $fraction, 0, $exponent );
		}

		// An unknown currency keeps the decimals as written.
		if ( null !== $currency ) {
			$fraction = str_pad( $fraction, $exponent, '0' );
		}

		$value    = ( '' === $whole ? '0' : $whole ) . ( '' === $fraction ? '' : '.' . $fraction );
		$negative = '-' === $matches[1] && '' !== trim( $value, '0.' );

		return ( $negative ? '-' : '' ) . $value;
	}

	/**
	 * Convert a canonical value into whole minor units.
	 *
	 * @param string      $value    Canonical value from normalize().
	 * @param string|null $currency Currency code, or null when unknown.
	 * @return int
	 */
	public static function to_minor( $value, $currency ) {
		$exponent = self::exponent( $currency );
		$negative = '-' === substr( $value, 0, 1 );
		$parts    = explode( '.', ltrim( $value, '-' ) );
		$fraction = str_pad( $parts[1] ?? '', $exponent, '0' );
		$minor    = (int) ( $parts[0] . $fraction );

		return $negative ? -$minor : $minor;
	}

	/**
	 * Convert whole minor units into a canonical value.
	 *
	 * @param int         $minor    Minor units.
	 * @param string|null $currency Currency code, or null when unknown.
	 * @return string
	 */
	public static function from_minor( $minor, $currency ) {
		$exponent = self::exponent( $currency );
		$digits   = str_pad( (string) abs( $minor ), $exponent + 1, '0', STR_PAD_LEFT );
		$value    = 0 === $exponent
			? $digits
			: substr( $digits, 0, -$exponent ) . '.' . substr( $digits, -$exponent );

		return ( $minor < 0 ? '-' : '' ) . $value;
	}

	/**
	 * Add canonical values exactly.
	 *
	 * @param string[]    $values   Canonical values.
	 * @param string|null $currency Currency code, or null when unknown.
	 * @return string
	 */
	public static function sum( array $values, $currency ) {
		$total = 0;
		foreach ( $values as $value ) {
			$total += self::to_minor( $value, $currency );
		}

		return self::from_minor( $total, $currency );
	}

	/**
	 * Whether two canonical values are the same amount.
	 *
	 * @param string      $a        Canonical value.
	 * @param string      $b        Canonical value.
	 * @param string|null $currency Currency code, or null when unknown.
	 * @return bool
	 */
	public static function equals( $a, $b, $currency ) {
		return self::to_minor( $a, $currency ) === self::to_minor( $b, $currency );
	}
}
