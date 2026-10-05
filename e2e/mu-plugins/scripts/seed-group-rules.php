<?php
/**
 * Seed a group with a pricing rule and a permission rule on an event date.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-group-rules.php <eventDateId>
 *
 * For the Groups tab availability spec (#1716): gives the tab existing rules
 * to load, and lets the spec check they survive feature toggling. Needs Fair
 * Events Experimental and Fair Audience Experimental active, so run it before
 * the spec deactivates anything.
 *
 * Prints a single `E2E_GROUP_RULES:{json}` line with the group name and the
 * ids cleanup-group-rules.php needs.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: seed-group-rules.php <eventDateId>' );
}

$group_name = 'E2E Groups Tab ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 );
$group      = new \FairAudienceExperimental\Models\Group( array( 'name' => $group_name ) );
$group->save();
$group_id = (int) $group->id;

$pricing_rule_id    = \FairEventsExperimental\Models\GroupPricingRule::create( $event_date_id, $group_id, 'percentage', 20 );
$permission_rule_id = \FairEventsExperimental\Models\GroupPermissionRule::create( $event_date_id, $group_id, 'view_signups' );

if ( ! $group_id || ! $pricing_rule_id || ! $permission_rule_id ) {
	WP_CLI::error( 'Could not seed the group and its rules.' );
}

echo 'E2E_GROUP_RULES:' . wp_json_encode(
	array(
		'eventDateId'      => $event_date_id,
		'groupId'          => $group_id,
		'groupName'        => $group_name,
		'pricingRuleId'    => (int) $pricing_rule_id,
		'permissionRuleId' => (int) $permission_rule_id,
	)
) . "\n";
