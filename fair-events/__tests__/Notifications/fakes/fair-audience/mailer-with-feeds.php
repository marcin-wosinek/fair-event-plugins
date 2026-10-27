<?php
/**
 * A Fair Audience release that reports each recipient and sends each
 * feed's email only to its subscribers.
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

	/**
	 * Send, reporting each recipient.
	 *
	 * @param string   $subject  Subject.
	 * @param string   $html     Body.
	 * @param callable $observer Observer.
	 * @return array
	 */
	public static function send_to_subscribers_reporting( $subject, $html, callable $observer ) {
		return array();
	}

	/**
	 * Send to one feed's subscribers, reporting each recipient.
	 *
	 * @param int      $feed_id  Feed ID.
	 * @param string   $subject  Subject.
	 * @param string   $html     Body.
	 * @param callable $observer Observer.
	 * @return array
	 */
	public static function send_to_feed_subscribers_reporting( $feed_id, $subject, $html, callable $observer ) {
		return array();
	}
}
