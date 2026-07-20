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
 *   (gallery invitations, poll invitations, confirmation emails, signup links)
 * - MARKETING: Promotional emails for events the participant hasn't signed up for
 *   (event invitations)
 * - WEEKLY_SUMMARY: The recurring weekly events digest. A subset of marketing
 *   sends: requires marketing consent like MARKETING, but is additionally
 *   gated by the participant's per-summary opt-out so they can stay on
 *   marketing mailings while skipping just the digest.
 */
class EmailType {
	const MINIMAL        = 'minimal';
	const MARKETING      = 'marketing';
	const WEEKLY_SUMMARY = 'weekly_summary';
}
