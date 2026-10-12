<?php
/**
 * Exact decimal handling for settlement report amounts
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Settlements;

defined( 'WPINC' ) || die;

/**
 * Mollie's settlement report states fees, VAT and rounding differences with
 * more decimals than the currency has minor units (`0.7545` EUR). Those are
 * real amounts, so they are kept exactly as supplied and calculated with at
 * their own scale.
 *
 * Payment, payout and CSV amounts keep the stricter currency rules of
 * Decimal; this class is only for the report.
 *
 * Values are decimal strings and all arithmetic is done on digit strings, so
 * nothing passes through a float or a native integer.
 */
class ReportDecimal {

	/**
	 * Most digits accepted before the decimal point.
	 */
	const MAX_INTEGER_DIGITS = 15;

	/**
	 * Most digits accepted after the decimal point. Mollie documents four.
	 */
	const MAX_SCALE = 8;

	/**
	 * Read a provider decimal, keeping the scale it was supplied with.
	 *
	 * Accepts an optional sign, digits, and a `.` decimal separator. A value
	 * with more digits than the bounds above is refused rather than cut
	 * short. Negative zero loses its sign; nothing else changes.
	 *
	 * @param mixed $raw Raw value.
	 * @return string|null The value as supplied, or null when it is not a decimal.
	 */
	public static function parse( $raw ) {
		if ( ! is_string( $raw ) && ! is_int( $raw ) ) {
			return null;
		}

		$pattern = '/^([+-]?)(\d{1,' . self::MAX_INTEGER_DIGITS . '})(?:\.(\d{1,' . self::MAX_SCALE . '}))?$/';
		if ( 1 !== preg_match( $pattern, trim( (string) $raw ), $matches ) ) {
			return null;
		}

		$whole    = ltrim( $matches[2], '0' );
		$fraction = $matches[3] ?? '';
		$value    = ( '' === $whole ? '0' : $whole ) . ( '' === $fraction ? '' : '.' . $fraction );
		$negative = '-' === $matches[1] && '' !== trim( $value, '0.' );

		return ( $negative ? '-' : '' ) . $value;
	}

	/**
	 * Number of decimals a value is written with.
	 *
	 * @param string $value Value from parse() or from this class.
	 * @return int
	 */
	public static function scale( $value ) {
		$dot = strpos( $value, '.' );

		return false === $dot ? 0 : strlen( $value ) - $dot - 1;
	}

	/**
	 * Add values exactly. The result has the largest scale among them.
	 *
	 * @param string[] $values Values from parse() or from this class.
	 * @return string
	 */
	public static function sum( array $values ) {
		$scale = 0;
		foreach ( $values as $value ) {
			$scale = max( $scale, self::scale( $value ) );
		}

		$negative = false;
		$total    = '0';
		foreach ( $values as $value ) {
			list( $value_negative, $digits ) = self::units( $value, $scale );

			if ( $value_negative === $negative ) {
				$total = self::add_digits( $total, $digits );
			} elseif ( self::compare_digits( $total, $digits ) >= 0 ) {
				$total = self::subtract_digits( $total, $digits );
			} else {
				$total    = self::subtract_digits( $digits, $total );
				$negative = $value_negative;
			}
		}

		return self::from_units( $negative, $total, $scale );
	}

	/**
	 * Subtract one value from another exactly.
	 *
	 * @param string $a Value.
	 * @param string $b Value taken away from it.
	 * @return string
	 */
	public static function subtract( $a, $b ) {
		return self::sum( array( $a, self::negate( $b ) ) );
	}

	/**
	 * Flip the sign of a value, keeping its scale. Zero stays unsigned.
	 *
	 * @param string $value Value.
	 * @return string
	 */
	public static function negate( $value ) {
		if ( self::is_zero( $value ) ) {
			return ltrim( $value, '-' );
		}

		return '-' === $value[0] ? substr( $value, 1 ) : '-' . $value;
	}

	/**
	 * Whether a value is zero at any scale.
	 *
	 * @param string $value Value.
	 * @return bool
	 */
	public static function is_zero( $value ) {
		return '' === trim( $value, '-0.' );
	}

	/**
	 * Compare two values numerically, whatever scale each is written with.
	 *
	 * @param string $a Value.
	 * @param string $b Value.
	 * @return int -1, 0 or 1.
	 */
	public static function compare( $a, $b ) {
		$scale = max( self::scale( $a ), self::scale( $b ) );

		list( $a_negative, $a_digits ) = self::units( $a, $scale );
		list( $b_negative, $b_digits ) = self::units( $b, $scale );

		if ( $a_negative !== $b_negative ) {
			return $a_negative ? -1 : 1;
		}

		$order = self::compare_digits( $a_digits, $b_digits );

		return $a_negative ? -$order : $order;
	}

	/**
	 * Whether two values are the same amount: `0.7500` equals `0.75`.
	 *
	 * @param string $a Value.
	 * @param string $b Value.
	 * @return bool
	 */
	public static function equals( $a, $b ) {
		return 0 === self::compare( $a, $b );
	}

	/**
	 * One spelling per amount, for comparing and hashing only. The supplied
	 * spelling stays the one that is stored and shown.
	 *
	 * @param string $value Value.
	 * @return string The value without trailing decimal zeros.
	 */
	public static function canonical( $value ) {
		if ( false !== strpos( $value, '.' ) ) {
			$value = rtrim( rtrim( $value, '0' ), '.' );
		}

		return self::is_zero( $value ) ? '0' : $value;
	}

	/**
	 * A value as a sign and a digit string of whole units at a scale.
	 *
	 * @param string $value Value.
	 * @param int    $scale Scale to express it at; not below its own.
	 * @return array{0: bool, 1: string} Whether it is negative, and its digits.
	 */
	private static function units( $value, $scale ) {
		$negative = '-' === substr( $value, 0, 1 );
		$parts    = explode( '.', ltrim( $value, '-' ) );
		$digits   = ltrim( $parts[0] . str_pad( $parts[1] ?? '', $scale, '0' ), '0' );
		$digits   = '' === $digits ? '0' : $digits;

		return array( $negative && '0' !== $digits, $digits );
	}

	/**
	 * A sign and a digit string of whole units as a value at a scale.
	 *
	 * @param bool   $negative Whether the value is negative.
	 * @param string $digits   Digits of whole units.
	 * @param int    $scale    Scale of those units.
	 * @return string
	 */
	private static function from_units( $negative, $digits, $scale ) {
		$digits = str_pad( $digits, $scale + 1, '0', STR_PAD_LEFT );
		$value  = 0 === $scale
			? $digits
			: substr( $digits, 0, -$scale ) . '.' . substr( $digits, -$scale );

		return ( $negative && '' !== trim( $digits, '0' ) ? '-' : '' ) . $value;
	}

	/**
	 * Compare two unsigned digit strings without leading zeros.
	 *
	 * @param string $a Digits.
	 * @param string $b Digits.
	 * @return int -1, 0 or 1.
	 */
	private static function compare_digits( $a, $b ) {
		if ( strlen( $a ) !== strlen( $b ) ) {
			return strlen( $a ) < strlen( $b ) ? -1 : 1;
		}

		return strcmp( $a, $b ) <=> 0;
	}

	/**
	 * Add two unsigned digit strings.
	 *
	 * @param string $a Digits.
	 * @param string $b Digits.
	 * @return string
	 */
	private static function add_digits( $a, $b ) {
		$length = max( strlen( $a ), strlen( $b ) );
		$a      = str_pad( $a, $length, '0', STR_PAD_LEFT );
		$b      = str_pad( $b, $length, '0', STR_PAD_LEFT );
		$result = '';
		$carry  = 0;

		for ( $i = $length - 1; $i >= 0; $i-- ) {
			$digit  = (int) $a[ $i ] + (int) $b[ $i ] + $carry;
			$carry  = $digit > 9 ? 1 : 0;
			$result = (string) ( $digit % 10 ) . $result;
		}

		return ( $carry ? '1' : '' ) . $result;
	}

	/**
	 * Subtract an unsigned digit string from one that is not smaller.
	 *
	 * @param string $a Digits.
	 * @param string $b Digits, not greater than $a.
	 * @return string
	 */
	private static function subtract_digits( $a, $b ) {
		$b      = str_pad( $b, strlen( $a ), '0', STR_PAD_LEFT );
		$result = '';
		$borrow = 0;

		for ( $i = strlen( $a ) - 1; $i >= 0; $i-- ) {
			$digit  = (int) $a[ $i ] - (int) $b[ $i ] - $borrow;
			$borrow = $digit < 0 ? 1 : 0;
			$result = (string) ( $digit + ( $borrow ? 10 : 0 ) ) . $result;
		}

		$result = ltrim( $result, '0' );

		return '' === $result ? '0' : $result;
	}
}
