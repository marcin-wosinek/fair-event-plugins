<?php
/**
 * A Fair Events release that stores purchase provenance.
 *
 * @package FairAudience
 */

namespace FairEvents\Services;

// phpcs:disable Generic.Classes.DuplicateClassName -- stand-ins with Fair Events' signatures, one loaded per test process.

/**
 * Stand-in capabilities.
 */
class PaymentHistoryCompatibility {

	/**
	 * Whether provenance is stored.
	 *
	 * @return bool
	 */
	public static function purchase_provenance_available() {
		return ! empty( $GLOBALS['_fair_test_provenance_available'] );
	}
}
