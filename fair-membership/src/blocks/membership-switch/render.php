<?php
/**
 * Server-side rendering for Membership Switch block
 *
 * @package FairMembership
 */

defined( 'WPINC' ) || die;

use FairMembership\Utils\MembershipChecker;

// Get block attributes
$group_ids = $attributes['groupIds'] ?? array();

// Get current user ID
$current_user_id = get_current_user_id();

// Determine which content to show
$show_member_content = false;

if ( $current_user_id > 0 && ! empty( $group_ids ) ) {
	// User is logged in and groups are selected
	$show_member_content = MembershipChecker::user_is_member_of_groups( $current_user_id, $group_ids );
}

// Parse the content to extract member and non-member sections
$member_content     = '';
$non_member_content = '';

if ( ! empty( $content ) ) {
	// Use DOMDocument to parse the HTML content
	$dom = new DOMDocument();
	// Suppress warnings for HTML5 tags
	@$dom->loadHTML( '<?xml encoding="UTF-8">' . $content, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );

	$xpath = new DOMXPath( $dom );

	// Find member-content block
	$member_nodes = $xpath->query( "//*[contains(@class, 'wp-block-fair-membership-member-content')]" );
	if ( $member_nodes->length > 0 ) {
		$member_content = $dom->saveHTML( $member_nodes->item( 0 ) );
	}

	// Find non-member-content block
	$non_member_nodes = $xpath->query( "//*[contains(@class, 'wp-block-fair-membership-non-member-content')]" );
	if ( $non_member_nodes->length > 0 ) {
		$non_member_content = $dom->saveHTML( $non_member_nodes->item( 0 ) );
	}
}

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'membership-switch-container',
	)
);

// Render the appropriate content
?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php
	if ( $show_member_content ) {
		echo wp_kses_post( $member_content );
	} else {
		echo wp_kses_post( $non_member_content );
	}
	?>
</div>
