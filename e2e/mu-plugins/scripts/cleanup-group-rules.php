<?php
/**
 * Delete what seed-group-rules.php created: an event date's group rules and
 * the seeded group.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-group-rules.php <eventDateId> <groupId>
 *
 * Needs Fair Events Experimental and Fair Audience Experimental active, so run
 * it after the spec has restored them.
 *
 * Prints a single `E2E_GROUP_RULES_CLEANUP:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
$group_id      = isset( $args[1] ) ? (int) $args[1] : 0;
if ( ! $event_date_id || ! $group_id ) {
	WP_CLI::error( 'Usage: cleanup-group-rules.php <eventDateId> <groupId>' );
}

\FairEventsExperimental\Models\GroupPricingRule::delete_by_event_date_id( $event_date_id );
\FairEventsExperimental\Models\GroupPermissionRule::delete_by_event_date_id( $event_date_id );

$group_deleted = ( new \FairAudienceExperimental\Models\Group( array( 'id' => $group_id ) ) )->delete();

echo 'E2E_GROUP_RULES_CLEANUP:' . wp_json_encode( array( 'group' => $group_deleted ? 1 : 0 ) ) . "\n";
