<?php
/**
 * Plain values from Mollie SDK fields
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

defined( 'WPINC' ) || die;

/**
 * Reads Mollie SDK fields as the plain strings the plugin stores and compares.
 *
 * The SDK reports a status, method or other value set as an enum case when it
 * knows the value and as Mollie's raw string when it does not. Transaction
 * records, REST responses and the `fair_payment_*` hooks all expect the raw
 * string, so values are converted here, at the SDK boundary.
 */
class MollieValue {

	/**
	 * The plain string of an enum-or-string SDK field.
	 *
	 * @param mixed $value Enum case, string, or anything else.
	 * @return string|null The string value, or null when there is none.
	 */
	public static function text( $value ) {
		if ( $value instanceof \BackedEnum ) {
			$value = $value->value;
		}

		return is_string( $value ) && '' !== $value ? $value : null;
	}
}
