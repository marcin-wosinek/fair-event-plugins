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
 */
class EmailType {
	const MINIMAL   = 'minimal';
	const MARKETING = 'marketing';
}
