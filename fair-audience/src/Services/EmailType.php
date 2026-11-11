<?php
/**
 * Email Type Constants
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Constants for email type classification.
 *
 * - MINIMAL: Essential emails related to events the participant attended or requested
 *   (poll invitations, confirmation emails, signup links)
 * - MARKETING: Promotional emails for events the participant hasn't signed up for
 *   (event invitations)
 * - WEEKLY_SUMMARY: The recurring weekly email of an event feed. Independent
 *   of general marketing consent: it goes to confirmed participants who
 *   subscribed to that feed and did not pause the weekly summary, so they
 *   can receive feeds without other marketing mailings and the other way
 *   round.
 */
class EmailType {
	const MINIMAL        = 'minimal';
	const MARKETING      = 'marketing';
	const WEEKLY_SUMMARY = 'weekly_summary';
}
