<?php
/**
 * A Fair Audience release that hands the weekly email over but cannot
 * report each recipient.
 *
 * @package FairEvents
 */

namespace FairAudience\Services;

// phpcs:disable Generic.CodeAnalysis.UnusedFunctionParameter, Generic.Classes.DuplicateClassName -- stand-ins with Fair Audience's signatures, one loaded per test process.

/**
 * Stand-in mailer.
 */
class WeeklyDigestMailer {

	/**
	 * Send.
	 *
	 * @param string $subject Subject.
	 * @param string $html    Body.
	 * @return array
	 */
	public static function send_to_subscribers( $subject, $html ) {
		return array();
	}
}
